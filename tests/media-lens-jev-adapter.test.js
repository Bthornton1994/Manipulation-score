import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  createJevAdapter,
  loadQuestionSet,
  validateQuestionSetContract,
  validateAndSanitizeAnswers,
  isRetryableStatus,
  parseRetryAfterMs,
  buildContractAnswers,
  JEV_MODEL_REQUESTED,
  JEV_MAX_RETRY_ATTEMPTS,
  JEV_MAX_SPAN_CHARS,
  JEV_REVIEW_MIN_CONFIDENCE
} from '../media-lens/worker/adapters/jev.js';
import { canonicalStringify } from '../media-lens/worker/jev/canonical-json.js';
import { createHash } from 'node:crypto';

async function withMockServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, server);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
}

const SAMPLE_SPANS = [
  { id: 'span-1', role: 'authorial', text: 'The council voted on Tuesday.' },
  { id: 'span-2', role: 'quoted', text: 'We will act immediately.' }
];

const ARTIFACT = { kind: 'article', title: 't' };

async function contractBody({ choice = 'none', probability = 0.9, noul = 0.1, model = JEV_MODEL_REQUESTED, confidence } = {}) {
  const { optionIds } = await loadQuestionSet();
  return {
    model,
    answers: buildContractAnswers({ optionIds, choice, probability, noul, confidence })
  };
}

test('the committed question-set hash matches a fresh canonical hash of questions.v1.json', async () => {
  const questionsSrc = await readFile('media-lens/worker/jev/questions.v1.json', 'utf8');
  const questions = JSON.parse(questionsSrc);
  const freshHash = createHash('sha256').update(canonicalStringify(questions), 'utf8').digest('hex');
  const { sha256, committed } = await loadQuestionSet();
  assert.equal(sha256, freshHash);
  assert.equal(sha256, committed, 'questions.v1.sha256 is out of date; regenerate it after editing questions.v1.json');
});

test('questions.v1.json matches the pinned TypeSafe Choice/Noul request shape', async () => {
  const { questions, optionIds } = await loadQuestionSet();
  assert.deepEqual(validateQuestionSetContract(questions), optionIds);
  assert.equal(questions.influence_signal.type, 'choice');
  assert.equal(Array.isArray(questions.influence_signal.criteria), false);
  assert.equal(typeof questions.influence_signal.criteria, 'object');
  assert.ok(optionIds.includes('none'));
  assert.equal(optionIds.includes('selective_context_candidate'), false);
  assert.equal(questions.is_quoted_or_attributed.type, 'noul');
  assert.equal(typeof questions.is_quoted_or_attributed.criteria.true, 'string');
  assert.equal(typeof questions.is_quoted_or_attributed.criteria.false, 'string');
  assert.equal('is_checkable_claim' in questions, false);
  assert.equal('claim_kind' in questions, false);
});

test('an array Choice criteria is rejected as not matching the TypeSafe contract', () => {
  assert.throws(
    () =>
      validateQuestionSetContract({
        influence_signal: { type: 'choice', instructions: 'Read `span.text`.', criteria: ['urgency', 'none'] },
        is_quoted_or_attributed: {
          type: 'noul',
          instructions: 'Does `span.text` look quoted?',
          criteria: { true: 'quoted', false: 'authorial' }
        }
      }),
    /Choice map/
  );
});

test('fixture mode: missing span id in the fixture file is a failure, not a fabricated answer', async () => {
  const adapter = createJevAdapter({
    mode: 'fixture',
    fixtureId: 'synthetic-01-quoted-vs-authorial',
    fixtureDir: 'media-lens/fixtures/jev'
  });
  const result = await adapter.analyzeSpans(SAMPLE_SPANS, ARTIFACT);
  assert.ok(result.answersBySpanId.has('span-1'), 'span-1 is present in the fixture and must be kept');
  assert.ok(result.failedSpanIds.has('span-2'), 'span-2 is absent from the fixture and must not be fabricated');
  assert.equal(result.answersBySpanId.has('span-2'), false);
  assert.equal(result.unavailableSpanIds.has('span-2'), true);
  assert.equal(result.modelReported, JEV_MODEL_REQUESTED);
  assert.equal(result.modelMatch, true);
});

test('live mode: a 429 response is retried and eventually succeeds', async () => {
  let callCount = 0;
  const body = await contractBody({ choice: 'urgency', probability: 0.8, noul: 0.2 });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      callCount += 1;
      if (callCount === 1) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 0);
      assert.ok(result.answersBySpanId.get('span-1'));
      assert.equal(result.answersBySpanId.get('span-1').influence_signal.choice, 'urgency');
      assert.ok(callCount >= 2, 'expected at least one retry after the 429');
    }
  );
});

test('live mode: 408 and 529 are retried; 401 and 422 are not', async () => {
  for (const { status, expectRetries } of [
    { status: 408, expectRetries: true },
    { status: 529, expectRetries: true },
    { status: 401, expectRetries: false },
    { status: 422, expectRetries: false }
  ]) {
    let callCount = 0;
    const body = await contractBody();
    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        callCount += 1;
        if (expectRetries && callCount === 1) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'retry_me' }));
          return;
        }
        if (!expectRetries) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'no_retry' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      },
      async (baseUrl) => {
        const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
        const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
        if (expectRetries) {
          assert.equal(result.failures, 0, `status ${status} should eventually succeed`);
          assert.ok(callCount >= 2, `status ${status} should retry`);
        } else {
          assert.equal(result.failures, 1, `status ${status} should not succeed`);
          assert.equal(callCount, 1, `status ${status} must not retry`);
          assert.equal(result.dispositionsBySpanId.get('span-1').reason, `http_${status}`);
        }
      }
    );
  }
});

test('isRetryableStatus matches the pinned TypeSafe retry set', () => {
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(529), true);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(422), false);
  assert.equal(isRetryableStatus(404), false);
});

test('parseRetryAfterMs reads delay-seconds, retry-after-ms, and HTTP-date', () => {
  const headers = (obj) => ({ get: (name) => obj[name.toLowerCase()] ?? null });
  assert.equal(parseRetryAfterMs(headers({ 'retry-after': '2' })), 2000);
  assert.equal(parseRetryAfterMs(headers({ 'retry-after-ms': '150' })), 150);
  const future = new Date(Date.now() + 3000).toUTCString();
  const fromDate = parseRetryAfterMs(headers({ 'retry-after': future }));
  assert.ok(fromDate > 500 && fromDate <= 4000);
});

test('live mode honors Retry-After on 429 without waiting the uncapped header', async () => {
  let callCount = 0;
  const startedAt = Date.now();
  const body = await contractBody();
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      callCount += 1;
      if (callCount === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after-ms': '40' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 0);
      assert.equal(callCount, 2);
      assert.ok(Date.now() - startedAt < 2000);
    }
  );
});

test('H1: an out-of-taxonomy influence_signal.choice is treated as a failure, never returned as an answer', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: JEV_MODEL_REQUESTED,
          answers: {
            influence_signal: {
              type: 'choice',
              choice: 'outlet_is_untrustworthy_propaganda',
              probabilities: { outlet_is_untrustworthy_propaganda: 0.99 },
              confidence: 0.99
            },
            is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.ok(result.failedSpanIds.has('span-1'));
      assert.equal(result.answersBySpanId.has('span-1'), false);
      assert.equal(result.dispositionsBySpanId.get('span-1').status, 'unavailable');
    }
  );
});

test('H1: selective_context_candidate is fusion-only and is rejected as a Jev choice', async () => {
  const { optionIds } = await loadQuestionSet();
  const validated = validateAndSanitizeAnswers(
    {
      influence_signal: {
        type: 'choice',
        choice: 'selective_context_candidate',
        probabilities: { selective_context_candidate: 0.9 },
        confidence: 0.9
      },
      is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
    },
    optionIds
  );
  assert.equal(validated.ok, false);
});

test('H1: an out-of-range probability value is treated as a failure', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: JEV_MODEL_REQUESTED,
          answers: {
            influence_signal: { type: 'choice', choice: 'urgency', probabilities: { urgency: 1.5 }, confidence: 0.9 },
            is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
    }
  );
});

test('H1: "none" is still accepted as a valid choice', async () => {
  const body = await contractBody({ choice: 'none', probability: 0.9, noul: 0.1 });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 0);
      assert.ok(result.answersBySpanId.has('span-1'));
    }
  );
});

test('L2: questions.v1.json no longer asks is_checkable_claim or claim_kind (nothing consumed them)', async () => {
  const { questions } = await loadQuestionSet();
  assert.equal('is_checkable_claim' in questions, false);
  assert.equal('claim_kind' in questions, false);
  assert.ok('influence_signal' in questions);
  assert.ok('is_quoted_or_attributed' in questions);
});

test('live mode: a malformed answer body is treated as a failure', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: JEV_MODEL_REQUESTED, answers: { influence_signal: { type: 'choice', choice: 'urgency' } } }));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.ok(result.failedSpanIds.has('span-1'));
    }
  );
});

test('live mode: non-JSON 200 bodies are malformed and are not retried', async () => {
  let callCount = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      callCount += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not-json');
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.equal(callCount, 1);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'malformed_json');
    }
  );
});

test('live mode: a reported model different from the requested one is flagged as a mismatch', async () => {
  const body = await contractBody({ choice: 'none', probability: 0.9, noul: 0.1, model: 'jev-1.10.0' });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.modelReported, 'jev-1.10.0');
      assert.equal(result.modelMatch, false);
      assert.equal(result.failures, 0);
    }
  );
});

test('live mode: 21% failures still report failures accurately for fusion to act on', async () => {
  const ok = await contractBody();
  await withMockServer(
    async (req, res) => {
      const body = await readJsonBody(req);
      if (body.state?.span?.id === 'span-5') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok));
    },
    async (baseUrl) => {
      const spans = Array.from({ length: 10 }, (_, i) => ({ id: `span-${i + 1}`, role: 'authorial', text: `Sentence ${i + 1}.` }));
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 2, timeoutMs: 2000 });
      const result = await adapter.analyzeSpans(spans, ARTIFACT);
      assert.equal(result.calls, 10);
      assert.equal(result.failures, 1);
      assert.ok(result.failedSpanIds.has('span-5'));
    }
  );
});

test('disabled mode returns no calls and no answers without any network access', async () => {
  const adapter = createJevAdapter({ mode: 'disabled' });
  const result = await adapter.analyzeSpans(SAMPLE_SPANS, ARTIFACT);
  assert.equal(result.calls, 0);
  assert.equal(result.answersBySpanId.size, 0);
});

test('live requests pin jev-1.13.0 and send the closed Choice map, never free-form questions', async () => {
  let seen = null;
  const body = await contractBody();
  await withMockServer(
    async (req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/systemone');
      assert.match(req.headers.authorization, /^Bearer test-key$/);
      seen = await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const longText = 'x'.repeat(JEV_MAX_SPAN_CHARS + 50);
      await adapter.analyzeSpans([{ id: 'span-1', role: 'authorial', text: longText }], ARTIFACT);
    }
  );
  assert.equal(seen.model, JEV_MODEL_REQUESTED);
  assert.equal(seen.questions.influence_signal.type, 'choice');
  assert.equal(Array.isArray(seen.questions.influence_signal.criteria), false);
  assert.equal(typeof seen.questions.influence_signal.criteria.urgency, 'string');
  assert.equal(seen.questions.is_quoted_or_attributed.type, 'noul');
  assert.equal(typeof seen.questions.is_quoted_or_attributed.criteria.true, 'string');
  assert.equal(seen.state.span.text.length, JEV_MAX_SPAN_CHARS);
  assert.equal(seen.state.span.id, 'span-1');
  assert.equal(Object.keys(seen.questions).includes('is_checkable_claim'), false);
});

test('live mode: incomplete probability maps fail closed', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: JEV_MODEL_REQUESTED,
          answers: {
            influence_signal: { type: 'choice', choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
            is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'incomplete_distribution');
    }
  );
});

test('live mode: choice that is not argmax is rejected', async () => {
  const { optionIds } = await loadQuestionSet();
  const answers = buildContractAnswers({ optionIds, choice: 'none', probability: 0.91, noul: 0.1 });
  answers.influence_signal.choice = 'urgency';
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: JEV_MODEL_REQUESTED, answers }));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'choice_not_argmax');
    }
  );
});

test('free-form explanation fields are dropped and never become the recorded answer', async () => {
  const { optionIds } = await loadQuestionSet();
  const answers = buildContractAnswers({ optionIds, choice: 'none', probability: 0.9, noul: 0.1 });
  answers.influence_signal.explanation = 'This proves the outlet is unsafe propaganda.';
  answers.generated_text = 'The claim is true.';
  answers.is_checkable_claim = { type: 'noul', noul: 0.99 };
  const validated = validateAndSanitizeAnswers(answers, optionIds, { requireCompleteDistribution: true });
  assert.equal(validated.ok, true);
  assert.equal(validated.answers.influence_signal.explanation, undefined);
  assert.equal(validated.answers.generated_text, undefined);
  assert.equal('is_checkable_claim' in validated.answers, false);
  assert.deepEqual(Object.keys(validated.answers.influence_signal).sort(), ['choice', 'confidence', 'probabilities', 'type']);
});

test('low confidence is review, not treated as a high-certainty signal', async () => {
  const { optionIds } = await loadQuestionSet();
  const answers = buildContractAnswers({
    optionIds,
    choice: 'bandwagon',
    probability: 0.41,
    noul: 0.1,
    confidence: JEV_REVIEW_MIN_CONFIDENCE - 0.01
  });
  const validated = validateAndSanitizeAnswers(answers, optionIds, { requireCompleteDistribution: true });
  assert.equal(validated.ok, true);
  assert.equal(validated.review, true);
});

test('live mode: per-attempt timeout is retried then marked unavailable', async () => {
  let callCount = 0;
  await withMockServer(
    (req, res) => {
      callCount += 1;
      req.resume();
      // Never respond; the adapter timeout must abort the request.
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1, timeoutMs: 40 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'timeout');
      assert.equal(callCount, JEV_MAX_RETRY_ATTEMPTS);
    }
  );
});

test('live mode: outer abort cancels retries immediately', async () => {
  let callCount = 0;
  const controller = new AbortController();
  await withMockServer(
    async (req, res) => {
      callCount += 1;
      await readJsonBody(req);
      if (callCount === 1) controller.abort();
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate_limited' }));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], ARTIFACT, { signal: controller.signal });
      assert.equal(result.failures, 1);
      assert.ok(callCount <= 2, `abort must not walk the full retry schedule, saw ${callCount}`);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'aborted');
    }
  );
});
