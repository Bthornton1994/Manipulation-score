import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildContractAnswers,
  createJevAdapter,
  loadQuestionSet,
  JEV_MODEL_REQUESTED,
  JEV_QUESTION_SET_NAME
} from '../media-lens/worker/adapters/jev.js';
import {
  JEV_TRACE_RECORD_KEYS,
  buildRedactedJevTraceRecord,
  createJevDevTracer,
  createMemoryTraceExporter
} from '../media-lens/worker/dev-tracing/jev-trace.js';

// Synthetic sentinels. None of them may appear in any trace record.
const SPAN_SENTINEL = 'SENTINEL-SPAN-TEXT-9f3a act before midnight';
const CONTEXT_SENTINEL = 'SENTINEL-CONTEXT-41c2 neighbouring sentence';
const TITLE_SENTINEL = 'SENTINEL-TITLE-77 synthetic artifact';
const KEY_SENTINEL = 'sk-SENTINELKEY0000000000000000';
const BASE_URL = 'https://jev.invalid';

const SPANS = [
  { id: 'span-1', role: 'authorial', text: SPAN_SENTINEL },
  { id: 'span-2', role: 'authorial', text: CONTEXT_SENTINEL }
];
const ARTIFACT = { kind: 'article', title: TITLE_SENTINEL };

async function contractBody(extra = {}) {
  const { optionIds } = await loadQuestionSet();
  return {
    model: JEV_MODEL_REQUESTED,
    answers: buildContractAnswers({ optionIds, choice: 'urgency', probability: 0.8, noul: 0.1 }),
    ...extra
  };
}

function stubFetch(bodyFor) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = await bodyFor(calls.length);
    return {
      ok: true,
      status: 200,
      redirected: false,
      type: 'basic',
      headers: new Headers(),
      json: async () => body
    };
  };
  return { calls, fetchImpl };
}

test('tracing is off by default: adapter only calls the Jev endpoint and exposes no tracer', async () => {
  const body = await contractBody();
  const { calls, fetchImpl } = stubFetch(() => body);
  const adapter = createJevAdapter({ mode: 'live', baseUrl: BASE_URL, apiKey: KEY_SENTINEL, fetchImpl, concurrency: 1 });
  const result = await adapter.analyzeSpans(SPANS, ARTIFACT);
  assert.equal(result.failures, 0);
  assert.equal(calls.length, SPANS.length);
  for (const call of calls) assert.equal(call.url, `${BASE_URL}/v1/systemone`);
  assert.deepEqual(Object.keys(adapter).sort(), ['analyzeSpans', 'mode']);
});

test('production wiring never constructs a dev tracer and jev.js does not import one', async () => {
  const [server, config, jev] = await Promise.all([
    readFile('media-lens/worker/server.js', 'utf8'),
    readFile('media-lens/worker/config.js', 'utf8'),
    readFile('media-lens/worker/adapters/jev.js', 'utf8')
  ]);
  for (const [name, src] of [['server.js', server], ['config.js', config]]) {
    assert.doesNotMatch(src, /devTracer|dev-tracing|langfuse/i, `${name} must not wire dev tracing`);
  }
  assert.doesNotMatch(jev, /import[^;]*dev-tracing/);
  assert.match(jev, /devTracer = null/);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  assert.equal(Object.keys(deps).some((name) => /langfuse|deepeval/i.test(name)), false);
});

test('enabled tracing records redacted metadata only for synthetic live calls', async () => {
  const body = await contractBody({ usage: { input_tokens: 12, output_tokens: 3 } });
  const { fetchImpl } = stubFetch(() => body);
  const { exporter, records } = createMemoryTraceExporter();
  const devTracer = createJevDevTracer({ exporter, runId: 'run-test-1' });
  const adapter = createJevAdapter({ mode: 'live', baseUrl: BASE_URL, apiKey: KEY_SENTINEL, fetchImpl, concurrency: 1, devTracer });
  const result = await adapter.analyzeSpans(SPANS, ARTIFACT);
  assert.equal(result.failures, 0);

  const { sha256, questions } = await loadQuestionSet();
  assert.equal(records.length, SPANS.length);
  for (const record of records) {
    assert.deepEqual(Object.keys(record), [...JEV_TRACE_RECORD_KEYS]);
    assert.equal(record.run_id, 'run-test-1');
    assert.equal(record.provider, 'typesafe');
    assert.equal(record.mode, 'live');
    assert.equal(record.model_requested, JEV_MODEL_REQUESTED);
    assert.equal(record.model_reported, JEV_MODEL_REQUESTED);
    assert.equal(record.question_set, JEV_QUESTION_SET_NAME);
    assert.equal(record.question_set_sha256, sha256);
    assert.deepEqual(record.usage, { input_tokens: 12, output_tokens: 3 });
    assert.equal(record.outcome, 'ok');
    assert.equal(record.error_category, null);
    assert.equal(typeof record.latency_ms, 'number');
  }

  const serialized = JSON.stringify(records);
  for (const forbidden of [SPAN_SENTINEL, CONTEXT_SENTINEL, TITLE_SENTINEL, KEY_SENTINEL, 'SENTINEL', BASE_URL, 'Bearer']) {
    assert.equal(serialized.includes(forbidden), false, `trace leaked ${forbidden}`);
  }
  assert.equal(serialized.includes(questions.influence_signal.instructions), false, 'trace leaked prompt text');
  assert.doesNotMatch(serialized, /probabilities|"choice"|noul/);
});

test('hostile response fields are dropped or bounded before export', async () => {
  const body = await contractBody({
    model: `${SPAN_SENTINEL} injected`,
    usage: { input_tokens: 5, note: SPAN_SENTINEL, nested: { x: 1 }, 'Bad-Key': 9, negative: -1 }
  });
  const { fetchImpl } = stubFetch(() => body);
  const { exporter, records } = createMemoryTraceExporter();
  const adapter = createJevAdapter({
    mode: 'live',
    baseUrl: BASE_URL,
    apiKey: KEY_SENTINEL,
    fetchImpl,
    concurrency: 1,
    devTracer: createJevDevTracer({ exporter, runId: 'run-test-2' })
  });
  await adapter.analyzeSpans([SPANS[0]], ARTIFACT);
  assert.equal(records.length, 1);
  assert.equal(records[0].model_reported, null);
  assert.deepEqual(records[0].usage, { input_tokens: 5 });
  assert.equal(JSON.stringify(records).includes('SENTINEL'), false);

  const odd = buildRedactedJevTraceRecord('run-x', { errorCategory: `boom: ${SPAN_SENTINEL}`, mode: 'other', questionSetSha256: 'nothex' });
  assert.equal(odd.error_category, 'other');
  assert.equal(odd.mode, null);
  assert.equal(odd.question_set_sha256, null);
});

test('failed calls and the call cap are traced with an error category, not content', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, redirected: false, type: 'basic', headers: new Headers(), json: async () => ({}) });
  const { exporter, records } = createMemoryTraceExporter();
  const adapter = createJevAdapter({
    mode: 'live',
    baseUrl: BASE_URL,
    apiKey: KEY_SENTINEL,
    fetchImpl,
    concurrency: 1,
    maxCallsPerAnalysis: 1,
    devTracer: createJevDevTracer({ exporter, runId: 'run-test-3' })
  });
  const result = await adapter.analyzeSpans(SPANS, ARTIFACT);
  assert.equal(result.capReached, true);
  assert.deepEqual(records.map((r) => [r.outcome, r.error_category]), [
    ['unavailable', 'http_401'],
    ['unavailable', 'jev_call_cap']
  ]);
  assert.equal(JSON.stringify(records).includes('SENTINEL'), false);
});

test('an exporter that throws does not change analysis results', async () => {
  const body = await contractBody();
  const { fetchImpl } = stubFetch(() => body);
  const devTracer = createJevDevTracer({
    exporter: () => {
      throw new Error('exporter down');
    },
    runId: 'run-test-4'
  });
  const adapter = createJevAdapter({ mode: 'live', baseUrl: BASE_URL, apiKey: KEY_SENTINEL, fetchImpl, concurrency: 1, devTracer });
  const result = await adapter.analyzeSpans(SPANS, ARTIFACT);
  assert.equal(result.failures, 0);
  assert.equal(result.answersBySpanId.size, SPANS.length);
});
