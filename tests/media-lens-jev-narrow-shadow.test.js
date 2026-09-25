import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig, publicConfig, effectiveLiveFlags, NARROW_SHADOW_APPROVED_OPERATING_POINTS } from '../media-lens/worker/config.js';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { normalizeForGolden } from '../media-lens/schema/golden.js';
import { validateContractSchema } from '../media-lens/worker/jev-usage-lab/schema-check.js';
import { SHADOW_EXTRA_JEV_CALLS_ENABLED, SHADOW_RETENTION } from '../media-lens/worker/jev-usage-lab/analyze-shadow.js';
import { SPAN_ROLES } from '../media-lens/worker/jev-usage-lab/decision.js';
import { loadQuestionSetFile, NARROW_QUESTION_SET_PATH } from '../media-lens/worker/jev-usage-lab/run.js';
import {
  NARROW_AUTHORIZATION,
  NARROW_SHADOW_ENV,
  NARROW_SHADOW_LIMIT_ENV,
  NARROW_SHADOW_ARTIFACT_KINDS,
  NARROW_SHADOW_MAX_CONTEXT_CHARS,
  NARROW_SHADOW_MAX_SAFE_ID_CHARS,
  NARROW_SHADOW_MAX_SPAN_CHARS,
  NARROW_SHADOW_MAX_TITLE_CHARS,
  narrowLiveRequestBody,
  armNarrowShadow,
  buildNarrowShadowReport,
  compareNarrowDecisionToProduction,
  createNarrowCostLedger,
  createNarrowLiveProvider,
  createNarrowRateLimiter,
  narrowLimitsPresent,
  narrowNetworkBlockReason,
  narrowShadowLiveNetworkPermitted,
  selectNarrowProvider
} from '../media-lens/worker/jev-usage-lab/narrow-shadow.js';

const CONSENT_AT = '2026-09-18T00:00:00.000Z';
const RECORDED_AT = '2026-09-22T00:00:00.000Z';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_SHA = 'ab'.repeat(32);
const API_KEY = 'sk-narrow-shadow-test-key';

const TEST_LIMITS = {
  maxCallsPerAnalysis: 4,
  timeoutMs: 1000,
  rateLimitPerMinute: 20,
  monthlyCostCeilingUsd: 5,
  estimatedUsdPerCall: 0.25
};

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        method,
        path,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stableGraph(graph) {
  return JSON.stringify(normalizeForGolden(graph));
}

function choiceAnswer(criteria, choice, probability = 0.8) {
  const optionIds = Object.keys(criteria);
  const others = optionIds.filter((id) => id !== choice);
  const each = others.length ? (1 - probability) / others.length : 0;
  const probabilities = {};
  for (const id of optionIds) probabilities[id] = id === choice ? probability : each;
  return { type: 'choice', choice, probabilities, confidence: probability, text: 'SENTINEL_SPAN_TEXT', api_key: API_KEY };
}

function answersFor(questionSet, choices) {
  const answers = {};
  for (const [questionId, choice] of Object.entries(choices)) {
    answers[questionId] = choiceAnswer(questionSet.questions[questionId].criteria, choice);
  }
  return answers;
}

function syntheticGraph() {
  return {
    graph_id: RUN_ID,
    artifact: {
      title: 'SENTINEL_SPAN_TEXT',
      url: 'https://user:sk-supersecretvalue@secret.example/private',
      byline: 'Jordan Reyes',
      text_sha256: TEXT_SHA,
      publisher: { domain: 'example.com' },
      kind: 'article'
    },
    spans: [
      { id: 'span-1', role: 'headline', role_basis: 'html_structure', text: 'SENTINEL_SPAN_TEXT one' },
      { id: 'span-2', role: 'byline_meta', role_basis: 'html_structure', text: 'SENTINEL_BYLINE' },
      { id: 'span-3', role: 'authorial', role_basis: 'default', text: 'SENTINEL_SPAN_TEXT two' }
    ],
    observations: [
      { signal: 'urgency', strength: 'observed', span_ids: ['span-1'], evidence: { engine: 'jev' }, ui_phrase: 'SENTINEL_SPAN_TEXT' }
    ],
    claims: [{ span_ids: ['span-1'], support: 'not_checked', text: 'SENTINEL_SPAN_TEXT' }],
    abstentions: [],
    engine: { jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls: 2 } }
  };
}

function limitEnv(overrides = {}) {
  return {
    MEDIA_LENS_MODE: 'fixture',
    [NARROW_SHADOW_ENV]: 'true',
    [NARROW_SHADOW_LIMIT_ENV.maxCallsPerAnalysis]: '8',
    [NARROW_SHADOW_LIMIT_ENV.timeoutMs]: '1000',
    [NARROW_SHADOW_LIMIT_ENV.rateLimitPerMinute]: '20',
    [NARROW_SHADOW_LIMIT_ENV.monthlyCostCeilingUsd]: '5',
    [NARROW_SHADOW_LIMIT_ENV.estimatedUsdPerCall]: '0.25',
    ...overrides
  };
}

test('narrow flag is exact, default off, and independent of capture', async () => {
  const unset = loadConfig({});
  assert.equal(unset.jevShadowNarrow.enabled, false);
  assert.equal(narrowLimitsPresent(unset.jevShadowNarrow), false);
  assert.equal(unset.jevShadowNarrow.maxCallsPerAnalysis, null);
  assert.equal(unset.jevShadowNarrow.timeoutMs, null);
  assert.equal(unset.jevShadowNarrow.rateLimitPerMinute, null);
  assert.equal(unset.jevShadowNarrow.monthlyCostCeilingUsd, null);
  assert.equal(unset.jevShadowNarrow.estimatedUsdPerCall, null);
  assert.equal(unset.jevShadow.enabled, false);
  assert.equal(unset.jevShadow.extraJevCallsEnabled, false);
  for (const value of ['TRUE', '1', 'true ', 'yes']) {
    const config = loadConfig({ [NARROW_SHADOW_ENV]: value });
    assert.equal(config.jevShadowNarrow.enabled, false, value);
  }
  const enabled = loadConfig({ [NARROW_SHADOW_ENV]: 'true' });
  assert.equal(enabled.jevShadowNarrow.enabled, true);
  assert.equal(enabled.jevShadow.enabled, false);
  assert.equal(enabled.jevShadow.extraJevCallsEnabled, false);
  assert.equal(narrowLimitsPresent(enabled.jevShadowNarrow), false);
  assert.equal(narrowShadowLiveNetworkPermitted(enabled), false);
  const captureOnly = loadConfig({ MEDIA_LENS_JEV_SHADOW: 'true' });
  assert.equal(captureOnly.jevShadow.enabled, true);
  assert.equal(captureOnly.jevShadowNarrow.enabled, false);
  assert.equal(SHADOW_EXTRA_JEV_CALLS_ENABLED, false);
  assert.deepEqual(publicConfig(unset), publicConfig(enabled));
  assert.equal(JSON.stringify(publicConfig(enabled)).includes('jevShadowNarrow'), false);
  assert.equal(JSON.stringify(publicConfig(enabled)).includes(NARROW_SHADOW_ENV), false);

  const configSource = await readFile('media-lens/worker/config.js', 'utf8');
  const serverSource = await readFile('media-lens/worker/server.js', 'utf8');
  const analyzeSource = await readFile('media-lens/worker/analyze.js', 'utf8');
  const narrowSource = await readFile('media-lens/worker/jev-usage-lab/narrow-shadow.js', 'utf8');
  assert.equal(configSource.includes(NARROW_SHADOW_ENV), true);
  for (const name of Object.values(NARROW_SHADOW_LIMIT_ENV)) assert.equal(configSource.includes(name), true);
  assert.equal(serverSource.includes(NARROW_SHADOW_ENV), false);
  assert.equal(serverSource.includes('MEDIA_LENS_JEV_SHADOW'), false);
  assert.equal(analyzeSource.includes('jev-usage-lab'), false);
  assert.equal(narrowSource.includes('createJevAdapter'), false);
  assert.equal(narrowSource.includes('typesafe-budget'), false);
  assert.equal((serverSource.match(/createNarrowLiveProvider\(/g) || []).length, 1);
  assert.equal((serverSource.match(/selectNarrowProvider\(/g) || []).length, 1);
});

test('live network stays disabled for fixture, CI, kill switch, and missing limits', () => {
  const ready = {
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: API_KEY,
    ...limitEnv({ MEDIA_LENS_MODE: 'live' })
  };
  const live = loadConfig(ready);
  assert.equal(narrowNetworkBlockReason(live), null);
  assert.equal(narrowShadowLiveNetworkPermitted(live), true);
  assert.equal(narrowNetworkBlockReason(loadConfig({ ...ready, CI: 'true' })), 'ci');
  assert.equal(narrowNetworkBlockReason(loadConfig({ ...ready, CI: '1' })), 'ci');
  assert.equal(narrowNetworkBlockReason(loadConfig({ ...ready, CI: 'false' })), null);
  assert.equal(narrowNetworkBlockReason(loadConfig({ ...ready, MEDIA_LENS_MODE: 'fixture' })), 'fixture_mode');
  assert.equal(narrowNetworkBlockReason(loadConfig({ ...ready, MEDIA_LENS_KILL_SWITCH: 'true' }), { killSwitchAsserted: true }), 'kill_switch');
  assert.equal(
    narrowNetworkBlockReason(loadConfig({ ...ready, MEDIA_LENS_TYPESAFE_API_KEY: '' })),
    'missing_api_key'
  );
  assert.equal(narrowNetworkBlockReason(loadConfig(limitEnv())), 'fixture_mode');
  assert.equal(narrowNetworkBlockReason(loadConfig({ [NARROW_SHADOW_ENV]: 'true' })), 'owner_limits_unset');
  const tooPricey = loadConfig({
    ...ready,
    [NARROW_SHADOW_LIMIT_ENV.estimatedUsdPerCall]: '3',
    [NARROW_SHADOW_LIMIT_ENV.monthlyCostCeilingUsd]: '1'
  });
  assert.equal(narrowNetworkBlockReason(tooPricey), 'monthly_cost_ceiling');
  for (const [name, value] of [
    [NARROW_SHADOW_LIMIT_ENV.maxCallsPerAnalysis, '0'],
    [NARROW_SHADOW_LIMIT_ENV.timeoutMs, ''],
    [NARROW_SHADOW_LIMIT_ENV.rateLimitPerMinute, 'nope'],
    [NARROW_SHADOW_LIMIT_ENV.monthlyCostCeilingUsd, '0'],
    [NARROW_SHADOW_LIMIT_ENV.estimatedUsdPerCall, '0']
  ]) {
    const config = loadConfig({ ...ready, [name]: value });
    assert.equal(narrowLimitsPresent(config.jevShadowNarrow), false, name);
    assert.equal(narrowShadowLiveNetworkPermitted(config), false, name);
  }

  let created = 0;
  const blocked = selectNarrowProvider({
    injected: null,
    livePermitted: narrowShadowLiveNetworkPermitted(loadConfig({ ...ready, CI: 'true' }), {
      killSwitchAsserted: effectiveLiveFlags(loadConfig({ ...ready, CI: 'true' })).killSwitch
    }),
    createLive() {
      created += 1;
      return { async ask() { throw new Error('live client constructed'); } };
    }
  });
  assert.equal(created, 0);
  assert.equal(blocked.provider, null);
  assert.equal(blocked.kind, 'network_disabled');
});

test('disabled narrow shadow makes zero provider calls', async () => {
  let calls = 0;
  const provider = {
    async ask() {
      calls += 1;
      throw new Error('disabled path called the provider');
    }
  };
  const armed = armNarrowShadow({ enabled: false, provider, graph: syntheticGraph(), sink() {} });
  assert.equal(armed.scheduled, false);
  assert.equal(armed.network_calls, 0);
  assert.equal(await armed.done, null);
  const report = await buildNarrowShadowReport({
    enabled: false,
    provider,
    graph: syntheticGraph(),
    limits: TEST_LIMITS
  });
  assert.equal(report.network_calls, 0);
  assert.equal(report.shadow_only, true);
  assert.equal(report.not_model_accuracy, true);
  assert.equal(report.not_production_ready, true);
  assert.equal(calls, 0);
});

test('enabled narrow shadow asks one bounded mock request per eligible span', async () => {
  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const seen = [];
  const provider = {
    async ask(request) {
      seen.push(request);
      return {
        ok: true,
        model_reported: 'jev-1.13.0',
        answers: answersFor(questionSet, {
          authorial_vs_quotation: request.state.span.role === 'quoted' ? 'quotation' : 'authorial',
          emotionally_loaded_language: 'loaded_moralized',
          false_dilemma: 'absent',
          claim_support_status: 'supported',
          source_independence: 'independent',
          important_context_missing: 'not_missing',
          should_abstain: 'answer'
        })
      };
    }
  };
  const graph = syntheticGraph();
  const before = JSON.stringify(graph);
  const report = await buildNarrowShadowReport({
    enabled: true,
    graph,
    articleHint: { mode: 'pasted_text' },
    limits: TEST_LIMITS,
    provider,
    providerKind: 'injected_mock',
    liveNetworkPermitted: false,
    liveNetworkBlockReason: 'fixture_mode',
    recordedAt: RECORDED_AT,
    deploymentSha: 'not-a-deploy'
  });
  assert.equal(JSON.stringify(graph), before);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((request) => request.span_id), ['span-1', 'span-3']);
  assert.equal(report.network_calls, 2);
  assert.equal(report.cross_span_batched, false);
  assert.equal(report.planner_http_calls, 0);
  assert.equal(report.provenance_plan_ok, true);
  assert.equal(report.question_set_id, 'media-lens-narrow.v1');
  assert.equal(report.deployment_sha, null);
  assert.equal(report.analysis_run_id, RUN_ID);
  assert.equal(report.article_id, TEXT_SHA);
  assert.equal(report.acted, false);
  assert.equal(report.shadow_only, true);
  assert.equal(report.not_model_accuracy, true);
  assert.equal(report.not_production_ready, true);
  assert.equal(report.label, 'narrow_shadow_only');
  assert.deepEqual(report.authorizes, NARROW_AUTHORIZATION);
  assert.equal(report.claim_support_applied, false);
  assert.equal(report.role_write_authorized, false);
  assert.equal(report.holdout_scored, false);
  assert.equal(report.splits_scored, false);
  assert.equal(report.split_isolation.split, 'runtime_shadow');
  assert.equal(report.split_isolation.collisions.length, 0);
  assert.equal(report.cost.available, false);
  assert.equal(report.cost.placeholder, true);
  assert.equal(report.cost.not_a_production_budget, true);
  assert.equal(report.cost.production_budget_written, false);
  assert.equal(report.production_question_set.authoritative, true);
  assert.equal(report.omitted_spans.some((item) => item.span_id === 'span-2' && item.reason === 'role_excluded'), true);
  for (const request of seen) {
    assert.equal(request.article_id, TEXT_SHA);
    assert.equal(request.source_id, 'example.com');
    assert.equal(request.analysis_run_id, RUN_ID);
    assert.equal(request.question_set_id, 'media-lens-narrow.v1');
    assert.equal(request.question_set_sha256, questionSet.sha256);
    assert.equal(request.model_requested, 'jev-1.13.0');
    assert.equal(request.deployment_sha, null);
    assert.equal(request.state.span.id, request.span_id);
    assert.equal(request.state.provenance.span_id, request.span_id);
    assert.equal(request.question_ids.includes('observed_vs_candidate'), false);
    assert.equal(Object.hasOwn(request.questions, 'observed_vs_candidate'), false);
    assert.equal(request.question_ids.length, 7);
    const other = seen.filter((item) => item.span_id !== request.span_id).map((item) => item.span_id);
    assert.equal(JSON.stringify(request.state.span).includes(other[0]), false);
  }
  assert.equal(seen[1].state.context.before, 'SENTINEL_SPAN_TEXT one');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /SENTINEL_SPAN_TEXT/);
  assert.doesNotMatch(serialized, /SENTINEL_BYLINE/);
  assert.doesNotMatch(serialized, /sk-/);
  assert.doesNotMatch(serialized, /https:\/\//);
  assert.equal(report.records[0].dropped_fields.includes('api_key'), true);
  const loaded = report.production_disagreements.find((item) => item.span_id === 'span-1' && item.question_id === 'emotionally_loaded_language');
  assert.equal(loaded.class, 'differ');
  assert.equal(loaded.applied_to_production, false);
  const claim = report.production_disagreements.find((item) => item.span_id === 'span-1' && item.question_id === 'claim_support_status');
  assert.equal(claim.class, 'held_not_applied');
  const role = report.production_disagreements.find((item) => item.span_id === 'span-1' && item.question_id === 'authorial_vs_quotation');
  assert.equal(role.class, 'role_recommendation_withheld');
  const source = report.records.find((item) => item.provenance.span_id === 'span-1' && item.question_id === 'source_independence');
  assert.equal(source.abstained, true);
  assert.equal(source.abstention_reason, 'insufficient_source_context');
  assert.equal(source.claim_support_applied, false);
  assert.equal(source.role_write_authorized, false);
  assert.equal(source.acted, false);
  assert.equal(source.measurement.basis, 'not_measured');
  const schema = JSON.parse(await readFile('schemas/jev-decision-contract.v1.json', 'utf8'));
  for (const record of report.records) {
    assert.deepEqual(validateContractSchema(schema, record), []);
    assert.equal(record.audit.question_set_sha256, questionSet.sha256);
    assert.equal(record.audit.deployment_sha, null);
    assert.equal(record.provenance.article_id, TEXT_SHA);
  }
  assert.ok(report.disagreement_count > 0);
});

test('owner limits, cap, rate, cost, timeout, and provider failure stay non-authoritative', async () => {
  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  let calls = 0;
  const provider = {
    async ask() {
      calls += 1;
      return { ok: true, model_reported: 'jev-1.13.0', answers: answersFor(questionSet, { should_abstain: 'answer', authorial_vs_quotation: 'authorial', emotionally_loaded_language: 'not_loaded', false_dilemma: 'absent', claim_support_status: 'not_checked', source_independence: 'insufficient_source_context', important_context_missing: 'not_missing' }) };
    }
  };
  const unset = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider,
    limits: { maxCallsPerAnalysis: null, timeoutMs: null, rateLimitPerMinute: null, monthlyCostCeilingUsd: null, estimatedUsdPerCall: null }
  });
  assert.equal(unset.network_calls, 0);
  assert.equal(unset.refused, 'owner_limits_unset');
  assert.equal(calls, 0);

  calls = 0;
  const capped = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider,
    providerKind: 'injected_mock',
    limits: { ...TEST_LIMITS, maxCallsPerAnalysis: 1 },
    recordedAt: RECORDED_AT
  });
  assert.equal(capped.network_calls, 1);
  assert.equal(capped.omitted_spans.some((item) => item.span_id === 'span-3' && item.reason === 'call_cap'), true);
  assert.equal(calls, 1);

  calls = 0;
  const limited = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider,
    providerKind: 'injected_mock',
    limits: TEST_LIMITS,
    rateLimiter: createNarrowRateLimiter({ perMinute: 1 }),
    costLedger: createNarrowCostLedger({ ceilingUsd: 5, estimatedUsdPerCall: 0.25 }),
    recordedAt: RECORDED_AT
  });
  assert.equal(limited.network_calls, 1);
  assert.equal(limited.omitted_spans.some((item) => item.reason === 'rate_limited'), true);

  calls = 0;
  const costly = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider,
    providerKind: 'injected_mock',
    limits: { ...TEST_LIMITS, estimatedUsdPerCall: 2, monthlyCostCeilingUsd: 2 },
    rateLimiter: createNarrowRateLimiter({ perMinute: 10 }),
    costLedger: createNarrowCostLedger({ ceilingUsd: 2, estimatedUsdPerCall: 2 }),
    recordedAt: RECORDED_AT
  });
  assert.equal(costly.network_calls, 1);
  assert.equal(costly.cost.production_budget_written, false);
  assert.equal(costly.omitted_spans.some((item) => item.reason === 'monthly_cost_ceiling'), true);

  const ledger = createNarrowCostLedger({
    ceilingUsd: 1,
    estimatedUsdPerCall: 1,
    now: () => new Date('2026-09-01T00:00:00.000Z')
  });
  assert.equal(ledger.tryReserve().ok, true);
  assert.equal(ledger.tryReserve().reason, 'monthly_cost_ceiling');
  let ticks = 0;
  const nextMonth = createNarrowCostLedger({
    ceilingUsd: 1,
    estimatedUsdPerCall: 1,
    now() {
      ticks += 1;
      return ticks < 3 ? new Date('2026-09-01T00:00:00.000Z') : new Date('2026-10-01T00:00:00.000Z');
    }
  });
  assert.equal(nextMonth.tryReserve().ok, true);
  assert.equal(nextMonth.tryReserve().ok, true);

  let asks = 0;
  const slow = {
    ask(request, { signal }) {
      asks += 1;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: true, answers: {}, text: 'SENTINEL_SPAN_TEXT' }), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve({ ok: false, error: 'ignored', text: 'SENTINEL_SPAN_TEXT' });
        });
      });
    }
  };
  const timed = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider: slow,
    providerKind: 'injected_mock',
    limits: { ...TEST_LIMITS, timeoutMs: 20, maxCallsPerAnalysis: 1 },
    recordedAt: RECORDED_AT
  });
  assert.equal(asks, 1);
  assert.equal(timed.network_calls, 1);
  assert.equal(timed.shadow_failed, true);
  assert.equal(timed.span_results[0].provider_error, 'timeout');
  assert.equal(timed.acted, false);
  assert.doesNotMatch(JSON.stringify(timed), /SENTINEL_SPAN_TEXT/);

  const failing = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'pasted_text' },
    provider: {
      async ask() {
        throw new Error(`SENTINEL_SPAN_TEXT ${API_KEY}`);
      }
    },
    providerKind: 'injected_mock',
    limits: { ...TEST_LIMITS, maxCallsPerAnalysis: 1 },
    recordedAt: RECORDED_AT
  });
  assert.equal(failing.span_results[0].provider_error, 'provider_failed');
  assert.equal(failing.authorizes.merge, false);
  assert.equal(failing.authorizes.spending, false);
  assert.doesNotMatch(JSON.stringify(failing), /SENTINEL_SPAN_TEXT|sk-/);
});

test('comparison helper does not authorize a production change', () => {
  const row = compareNarrowDecisionToProduction(
    {
      question_id: 'claim_support_status',
      selected_option: 'supported',
      abstained: false,
      final_action: 'hold_for_human',
      provenance: { span_id: 'span-1' }
    },
    { signal: 'none', strength: null, role: 'authorial', claim_supports: ['not_checked'], observations: [] }
  );
  assert.equal(row.class, 'held_not_applied');
  assert.equal(row.applied_to_production, false);
});

test('live provider client is mockable and does not echo secrets into its result', async () => {
  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const posts = [];
  let readBody = 0;
  const fetchImpl = async (url, init) => {
    posts.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: answersFor(questionSet, {
          authorial_vs_quotation: 'authorial',
          emotionally_loaded_language: 'not_loaded',
          false_dilemma: 'absent',
          claim_support_status: 'not_checked',
          source_independence: 'insufficient_source_context',
          important_context_missing: 'not_missing',
          should_abstain: 'answer'
        }),
        explanation: 'SENTINEL_SPAN_TEXT'
      })
    };
  };
  const provider = createNarrowLiveProvider({
    fetchImpl,
    baseUrl: 'https://api.typesafe.ai',
    apiKey: API_KEY,
    model: 'jev-1.13.0'
  });
  const report = await buildNarrowShadowReport({
    enabled: true,
    graph: {
      ...syntheticGraph(),
      spans: [{ id: 'span-1', role: 'authorial', role_basis: 'default', text: 'SENTINEL_SPAN_TEXT' }]
    },
    articleHint: { mode: 'pasted_text' },
    provider,
    providerKind: 'live_provider',
    limits: { ...TEST_LIMITS, maxCallsPerAnalysis: 1 },
    recordedAt: RECORDED_AT
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(posts[0].init.method, 'POST');
  assert.equal(posts[0].init.redirect, 'manual');
  assert.match(posts[0].init.headers.authorization, /^Bearer /);
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.model, 'jev-1.13.0');
  assert.equal(body.state.span.id, 'span-1');
  assert.equal(Object.hasOwn(body.questions, 'observed_vs_candidate'), false);
  assert.equal(report.network_calls, 1);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(API_KEY));
  assert.doesNotMatch(JSON.stringify(report), /SENTINEL_SPAN_TEXT/);

  const redirect = createNarrowLiveProvider({
    fetchImpl: async () => {
      readBody += 1;
      return { ok: false, status: 302, json: async () => { readBody += 10; return {}; } };
    },
    baseUrl: 'https://api.typesafe.ai',
    apiKey: API_KEY,
    model: 'jev-1.13.0'
  });
  const redirected = await redirect.ask({ state: { span: { id: 'span-1' } }, questions: {} });
  assert.equal(redirected.error, 'redirect_rejected');
  assert.equal(readBody, 1);
});

test('fixture /analyze keeps the production body when narrow shadow is off and when the mock is on', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = function countedFetch(...args) {
    fetchCalls += 1;
    return originalFetch.apply(this, args);
  };
  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  try {
    const offSeen = [];
    const offServer = await listen(
      createServer(loadConfig({ MEDIA_LENS_MODE: 'fixture' }), {
        narrowShadowSink(report) {
          offSeen.push(report);
        },
        narrowShadowProvider: {
          async ask() {
            throw new Error('disabled narrow provider');
          }
        }
      })
    );
    try {
      const health = await requestJson(offServer, { method: 'GET', path: '/health' });
      assert.equal(health.status, 200);
      assert.equal(Object.hasOwn(health.body, 'jevShadowNarrow'), false);
      const res = await requestJson(offServer, {
        method: 'POST',
        path: '/analyze',
        body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial', consent_at: CONSENT_AT }
      });
      assert.equal(res.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const baseline = await runFixture('synthetic-01-quoted-vs-authorial');
      assert.equal(stableGraph(res.body), stableGraph(baseline));
      assert.equal(offSeen.length, 0);
      assert.equal(fetchCalls, 0);
      assert.equal(Object.hasOwn(res.body, 'shadow_only'), false);
    } finally {
      offServer.close();
    }

    const calls = [];
    let releaseProvider = () => {};
    const providerGate = new Promise((resolve) => {
      releaseProvider = resolve;
    });
    let providerReleased = false;
    const seen = [];
    const budgetCalls = [];
    const config = loadConfig(limitEnv());
    assert.equal(narrowShadowLiveNetworkPermitted(config), false);
    const server = await listen(
      createServer(config, {
        typesafeBudget: {
          isStopped() {
            return false;
          },
          wouldExceed() {
            return false;
          },
          recordCalls(count) {
            budgetCalls.push(count);
            return { shouldWarn: false };
          }
        },
        narrowShadowProvider: {
          async ask(request) {
            calls.push(request);
            await providerGate;
            providerReleased = true;
            const role = request.state?.span?.role;
            return {
              ok: true,
              model_reported: 'jev-1.13.0',
              answers: answersFor(questionSet, {
                authorial_vs_quotation: role === 'quoted' ? 'quotation' : 'authorial',
                emotionally_loaded_language: 'loaded_moralized',
                false_dilemma: 'absent',
                claim_support_status: 'supported',
                source_independence: 'independent',
                important_context_missing: 'not_missing',
                should_abstain: 'answer'
              })
            };
          }
        },
        narrowShadowSink(report) {
          seen.push(report);
        }
      })
    );
    try {
      const res = await Promise.race([
        requestJson(server, {
          method: 'POST',
          path: '/analyze',
          body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial', consent_at: CONSENT_AT }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('analyze waited on narrow shadow')), 2000))
      ]);
      assert.equal(res.status, 200);
      assert.equal(providerReleased, false);
      const baseline = await runFixture('synthetic-01-quoted-vs-authorial');
      assert.equal(stableGraph(res.body), stableGraph(baseline));
      assert.equal(res.body.engine.jev.calls, baseline.engine.jev.calls);
      assert.equal(res.body.claims.every((claim) => claim.support === 'not_checked'), true);
      assert.equal(res.body.spans.find((span) => span.text.startsWith('Sources close to the situation')).role, 'uncertain');
      assert.equal(budgetCalls.length, 0);
      assert.equal(fetchCalls, 0);
      releaseProvider();
      const deadline = Date.now() + 1000;
      while (seen.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(seen.length, 1);
      const report = seen[0];
      assert.equal(report.shadow_only, true);
      assert.equal(report.not_model_accuracy, true);
      assert.equal(report.not_production_ready, true);
      assert.equal(report.network_calls, 6);
      assert.equal(calls.length, 6);
      assert.deepEqual(
        calls.map((request) => request.span_id),
        ['span-1', 'span-2', 'span-3', 'span-4', 'span-5', 'span-6']
      );
      assert.equal(report.live_network_permitted, false);
      assert.equal(report.live_network_block_reason, 'fixture_mode');
      assert.equal(report.provider_kind, 'injected_mock');
      assert.equal(report.acted, false);
      assert.equal(report.claim_support_applied, false);
      assert.equal(report.role_write_authorized, false);
      assert.equal(Object.values(report.authorizes).every((value) => value === false), true);
      assert.equal(report.analysis_run_id, res.body.graph_id);
      assert.equal(report.article_id, 'synthetic-01-quoted-vs-authorial');
      const span7 = report.records.find((record) => record.provenance.span_id === 'span-6' && record.question_id === 'authorial_vs_quotation');
      assert.equal(span7.provenance.span_role, 'authorial');
      assert.equal(span7.role_write_authorized, false);
      const loaded = report.production_disagreements.find(
        (item) => item.span_id === 'span-3' && item.question_id === 'emotionally_loaded_language'
      );
      assert.equal(loaded.class, 'differ');
      assert.equal(loaded.applied_to_production, false);
      assert.doesNotMatch(JSON.stringify(report), /downtown drainage|Jordan Reyes|SENTINEL|sk-/);
      assert.match(JSON.stringify(res.body), /downtown drainage/);
      assert.equal(providerReleased, true);
    } finally {
      releaseProvider();
      server.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const NARROW_MOCK_CHOICES = {
  authorial_vs_quotation: 'authorial',
  emotionally_loaded_language: 'not_loaded',
  false_dilemma: 'absent',
  claim_support_status: 'not_checked',
  source_independence: 'insufficient_source_context',
  important_context_missing: 'not_missing',
  should_abstain: 'answer'
};

function approvedLimitEnv(extra = {}) {
  const approved = NARROW_SHADOW_APPROVED_OPERATING_POINTS;
  return {
    [NARROW_SHADOW_ENV]: 'true',
    [NARROW_SHADOW_LIMIT_ENV.maxCallsPerAnalysis]: String(approved.maxCallsPerAnalysis),
    [NARROW_SHADOW_LIMIT_ENV.timeoutMs]: String(approved.timeoutMs),
    [NARROW_SHADOW_LIMIT_ENV.rateLimitPerMinute]: String(approved.rateLimitPerMinute),
    [NARROW_SHADOW_LIMIT_ENV.monthlyCostCeilingUsd]: '5.00',
    ...extra
  };
}

test('approved operating points parse, and an unset estimate refuses the network', async () => {
  const approved = NARROW_SHADOW_APPROVED_OPERATING_POINTS;
  assert.equal(approved.approvedOn, '2026-09-22');
  assert.equal(approved.maxCallsPerAnalysis, 5);
  assert.equal(approved.timeoutMs, 10000);
  assert.equal(approved.rateLimitPerMinute, 6);
  assert.equal(approved.monthlyCostCeilingUsd, 5);
  assert.equal(approved.estimatedUsdPerCall, 0.002);
  assert.equal(process.env.MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL, undefined);
  assert.equal(NARROW_SHADOW_MAX_SPAN_CHARS, 1200);
  assert.equal(NARROW_SHADOW_MAX_CONTEXT_CHARS, 400);
  assert.equal(SHADOW_RETENTION, 'stderr_process_log_only_no_disk_store');

  const configSource = await readFile('media-lens/worker/config.js', 'utf8');
  const loadBody = configSource.slice(configSource.indexOf('export function loadConfig'));
  assert.equal(loadBody.includes('NARROW_SHADOW_APPROVED_OPERATING_POINTS'), false);
  assert.equal(loadBody.includes('0.002'), false);
  assert.equal(configSource.includes('jev-usage-lab'), false);
  const shadowSource = await readFile('media-lens/worker/jev-usage-lab/analyze-shadow.js', 'utf8');
  assert.match(shadowSource, /export const SHADOW_RETENTION = 'stderr_process_log_only_no_disk_store'/);
  const narrowSource = await readFile('media-lens/worker/jev-usage-lab/narrow-shadow.js', 'utf8');
  assert.equal(narrowSource.includes('typesafe-budget'), false);
  assert.equal(narrowSource.includes('/var/lib/media-lens/typesafe-budget.json'), false);
  assert.equal(narrowSource.includes('writeFile'), false);
  const liveFn = narrowSource.slice(narrowSource.indexOf('export function createNarrowLiveProvider'));
  assert.equal((liveFn.match(/fetchImpl\(/g) || []).length, 1);

  const unset = loadConfig({});
  assert.equal(unset.jevShadowNarrow.maxCallsPerAnalysis, null);
  assert.equal(unset.jevShadowNarrow.estimatedUsdPerCall, null);

  const four = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: API_KEY,
    MEDIA_LENS_TYPESAFE_BASE_URL: 'https://api.typesafe.ai',
    ...approvedLimitEnv()
  });
  assert.equal(four.jevShadowNarrow.enabled, true);
  assert.equal(four.jevShadowNarrow.maxCallsPerAnalysis, approved.maxCallsPerAnalysis);
  assert.equal(four.jevShadowNarrow.timeoutMs, approved.timeoutMs);
  assert.equal(four.jevShadowNarrow.rateLimitPerMinute, approved.rateLimitPerMinute);
  assert.equal(four.jevShadowNarrow.monthlyCostCeilingUsd, approved.monthlyCostCeilingUsd);
  assert.equal(four.jevShadowNarrow.estimatedUsdPerCall, null);
  assert.notEqual(four.jevShadowNarrow.estimatedUsdPerCall, approved.estimatedUsdPerCall);
  assert.equal(narrowLimitsPresent(four.jevShadowNarrow), false);
  assert.equal(narrowNetworkBlockReason(four), 'owner_limits_unset');
  assert.equal(narrowShadowLiveNetworkPermitted(four), false);

  let created = 0;
  const selected = selectNarrowProvider({
    injected: null,
    livePermitted: narrowShadowLiveNetworkPermitted(four),
    createLive() {
      created += 1;
      return {
        async ask() {
          throw new Error('live client constructed');
        }
      };
    }
  });
  assert.equal(created, 0);
  assert.equal(selected.kind, 'network_disabled');
  assert.equal(selected.provider, null);

  let calls = 0;
  const report = await buildNarrowShadowReport({
    enabled: true,
    graph: syntheticGraph(),
    articleHint: { mode: 'url' },
    provider: {
      async ask() {
        calls += 1;
        throw new Error('estimate unset must not call');
      }
    },
    providerKind: 'injected_mock',
    limits: {
      maxCallsPerAnalysis: four.jevShadowNarrow.maxCallsPerAnalysis,
      timeoutMs: four.jevShadowNarrow.timeoutMs,
      rateLimitPerMinute: four.jevShadowNarrow.rateLimitPerMinute,
      monthlyCostCeilingUsd: four.jevShadowNarrow.monthlyCostCeilingUsd,
      estimatedUsdPerCall: four.jevShadowNarrow.estimatedUsdPerCall
    },
    liveNetworkPermitted: false,
    liveNetworkBlockReason: 'owner_limits_unset',
    recordedAt: RECORDED_AT
  });
  assert.equal(calls, 0);
  assert.equal(report.network_calls, 0);
  assert.equal(report.refused, 'owner_limits_unset');
  assert.equal(report.retention, SHADOW_RETENTION);
  assert.equal(report.shadow_only, true);
  assert.equal(report.not_model_accuracy, true);
  assert.equal(report.not_production_ready, true);
  assert.equal(report.cost.production_budget_written, false);
  assert.equal(report.cost.available, false);
  assert.equal(report.acted, false);
});

test('mock provider still runs when a test-only estimate accompanies the approved points', async () => {
  const testOnlyEstimateNotATypesafePrice = 0.01;
  const approved = NARROW_SHADOW_APPROVED_OPERATING_POINTS;
  const parsed = loadConfig({
    MEDIA_LENS_MODE: 'fixture',
    ...approvedLimitEnv({
      [NARROW_SHADOW_LIMIT_ENV.estimatedUsdPerCall]: '0.01'
    })
  });
  assert.equal(parsed.jevShadowNarrow.estimatedUsdPerCall, testOnlyEstimateNotATypesafePrice);
  assert.equal(narrowLimitsPresent(parsed.jevShadowNarrow), true);
  assert.equal(narrowNetworkBlockReason(parsed), 'fixture_mode');
  assert.equal(narrowShadowLiveNetworkPermitted(parsed), false);

  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const before = 'B'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 100);
  const middle = 'M'.repeat(NARROW_SHADOW_MAX_SPAN_CHARS + 300);
  const after = 'A'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 100);
  const graph = {
    graph_id: RUN_ID,
    artifact: {
      title: 'Public title',
      url: 'https://user:sk-supersecretvalue@secret.example/private',
      html: '<html>FULL_ARTICLE_BODY</html>',
      cookie: 'session=secret',
      text_sha256: TEXT_SHA,
      publisher: { domain: 'example.com' },
      kind: 'article'
    },
    spans: [
      { id: 'span-b', role: 'authorial', role_basis: 'default', text: before },
      { id: 'span-m', role: 'authorial', role_basis: 'default', text: middle },
      { id: 'span-a', role: 'authorial', role_basis: 'default', text: after }
    ],
    observations: [],
    claims: [],
    abstentions: [],
    engine: { jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls: 0 } }
  };
  const seen = [];
  const report = await buildNarrowShadowReport({
    enabled: true,
    graph,
    articleHint: { mode: 'url' },
    limits: {
      maxCallsPerAnalysis: approved.maxCallsPerAnalysis,
      timeoutMs: approved.timeoutMs,
      rateLimitPerMinute: approved.rateLimitPerMinute,
      monthlyCostCeilingUsd: approved.monthlyCostCeilingUsd,
      estimatedUsdPerCall: testOnlyEstimateNotATypesafePrice
    },
    provider: {
      async ask(request) {
        seen.push(request);
        return {
          ok: true,
          model_reported: 'jev-1.13.0',
          answers: answersFor(questionSet, NARROW_MOCK_CHOICES)
        };
      }
    },
    providerKind: 'injected_mock',
    liveNetworkPermitted: false,
    liveNetworkBlockReason: 'fixture_mode',
    recordedAt: RECORDED_AT
  });
  assert.equal(seen.length, 3);
  assert.equal(report.network_calls, 3);
  assert.equal(report.cross_span_batched, false);
  assert.equal(report.retention, SHADOW_RETENTION);
  assert.equal(report.cost.production_budget_written, false);
  assert.equal(report.cost.placeholder, true);
  assert.equal(report.shadow_only, true);
  assert.equal(report.not_model_accuracy, true);
  assert.equal(report.not_production_ready, true);
  const middleRequest = seen.find((request) => request.span_id === 'span-m');
  assert.equal(middleRequest.state.span.text.length, NARROW_SHADOW_MAX_SPAN_CHARS);
  assert.equal(middleRequest.state.context.before.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
  assert.equal(middleRequest.state.context.after.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
  assert.equal(middleRequest.state.artifact.title, 'Public title');
  assert.equal(middleRequest.state.artifact.kind, 'article');
  assert.deepEqual(Object.keys(middleRequest.state).sort(), ['artifact', 'context', 'provenance', 'span']);
  assert.equal(Object.hasOwn(middleRequest.state, 'url'), false);
  assert.equal(Object.hasOwn(middleRequest.state.artifact, 'url'), false);
  assert.equal(Object.hasOwn(middleRequest.state.artifact, 'html'), false);
  assert.equal(Object.hasOwn(middleRequest.state, 'html'), false);
  assert.equal(Object.hasOwn(middleRequest.state, 'cookie'), false);
  assert.equal(Object.hasOwn(middleRequest, 'cookie'), false);
  const wire = JSON.stringify(middleRequest);
  assert.equal(wire.includes('FULL_ARTICLE_BODY'), false);
  assert.equal(wire.includes('<html'), false);
  assert.equal(wire.includes('https://'), false);
  assert.equal(wire.includes('session=secret'), false);
  assert.equal(wire.includes('sk-'), false);
  assert.equal(middleRequest.state.span.text.length < middle.length, true);
  assert.doesNotMatch(JSON.stringify(report), /FULL_ARTICLE_BODY|session=secret|sk-/);
  assert.equal(JSON.stringify(report).includes('M'.repeat(80)), false);
});

test('worst-case narrow body truncates the title and stays inside the cap fence', async () => {
  assert.equal(NARROW_SHADOW_MAX_TITLE_CHARS, 2000);
  assert.equal(NARROW_SHADOW_APPROVED_OPERATING_POINTS.estimatedUsdPerCall, 0.002);
  assert.equal(process.env.MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL, undefined);
  assert.equal(process.env.MEDIA_LENS_TYPESAFE_API_KEY, undefined);
  assert.equal(process.env.MEDIA_LENS_JEV_SHADOW_NARROW, undefined);
  assert.equal(process.env.MEDIA_LENS_ENABLE_LIVE, undefined);

  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const sendableIds = Object.entries(questionSet.questions)
    .filter(([, question]) => question && question.send_to_jev !== false && question.policy !== 'derived')
    .map(([questionId]) => questionId);
  assert.equal(sendableIds.length, 7);
  assert.equal(sendableIds.includes('observed_vs_candidate'), false);

  const rawTitle = 'T'.repeat(5000);
  const spanText = 'M'.repeat(NARROW_SHADOW_MAX_SPAN_CHARS + 300);
  const beforeText = 'B'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 100);
  const afterText = 'A'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 100);
  const graph = {
    graph_id: RUN_ID,
    artifact: {
      title: rawTitle,
      text_sha256: TEXT_SHA,
      publisher: { domain: 'example.com' },
      kind: 'article'
    },
    spans: [
      { id: 'span-b', role: 'authorial', role_basis: 'default', text: beforeText },
      { id: 'span-m', role: 'authorial', role_basis: 'default', text: spanText },
      { id: 'span-a', role: 'authorial', role_basis: 'default', text: afterText }
    ],
    observations: [],
    claims: [],
    abstentions: [],
    engine: { jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls: 0 } }
  };

  const seen = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('title-cap test must not use the network');
  };
  try {
    const report = await buildNarrowShadowReport({
      enabled: true,
      graph,
      articleHint: { mode: 'url' },
      limits: {
        maxCallsPerAnalysis: NARROW_SHADOW_APPROVED_OPERATING_POINTS.maxCallsPerAnalysis,
        timeoutMs: NARROW_SHADOW_APPROVED_OPERATING_POINTS.timeoutMs,
        rateLimitPerMinute: NARROW_SHADOW_APPROVED_OPERATING_POINTS.rateLimitPerMinute,
        monthlyCostCeilingUsd: NARROW_SHADOW_APPROVED_OPERATING_POINTS.monthlyCostCeilingUsd,
        estimatedUsdPerCall: 0.01
      },
      provider: {
        async ask(request) {
          seen.push(request);
          return {
            ok: true,
            model_reported: 'jev-1.13.0',
            answers: answersFor(questionSet, NARROW_MOCK_CHOICES)
          };
        }
      },
      providerKind: 'injected_mock',
      liveNetworkPermitted: false,
      liveNetworkBlockReason: 'fixture_mode',
      recordedAt: RECORDED_AT
    });
    assert.equal(fetchCalls, 0);
    assert.equal(report.network_calls, 3);
    assert.equal(report.retention, 'stderr_process_log_only_no_disk_store');
    assert.equal(report.cost.production_budget_written, false);
    assert.equal(JSON.stringify(report).includes(rawTitle), false);
    assert.equal(JSON.stringify(report).includes('M'.repeat(80)), false);

    const middle = seen.find((request) => request.span_id === 'span-m');
    const body = narrowLiveRequestBody('jev-1.13.0', middle);
    assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']);
    assert.equal(body.model, questionSet.model_requested);
    assert.deepEqual(Object.keys(body.questions).sort(), [...sendableIds].sort());
    assert.equal(Object.hasOwn(body.questions, 'observed_vs_candidate'), false);
    assert.equal(body.state.artifact.title.length, NARROW_SHADOW_MAX_TITLE_CHARS);
    assert.equal(body.state.artifact.title, 'T'.repeat(NARROW_SHADOW_MAX_TITLE_CHARS));
    assert.equal(body.state.span.text.length, NARROW_SHADOW_MAX_SPAN_CHARS);
    assert.ok(body.state.span.text.length <= NARROW_SHADOW_MAX_SPAN_CHARS);
    assert.equal(body.state.context.before.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
    assert.equal(body.state.context.after.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
    assert.ok(body.state.context.before.length <= NARROW_SHADOW_MAX_CONTEXT_CHARS);
    assert.ok(body.state.context.after.length <= NARROW_SHADOW_MAX_CONTEXT_CHARS);

    const serialized = JSON.stringify(body);
    const skeleton = JSON.parse(serialized);
    skeleton.state.artifact.title = '';
    skeleton.state.span.text = '';
    skeleton.state.context.before = '';
    skeleton.state.context.after = '';
    const structuralChars = JSON.stringify(skeleton).length;
    const boundedTextChars =
      NARROW_SHADOW_MAX_TITLE_CHARS +
      NARROW_SHADOW_MAX_SPAN_CHARS +
      NARROW_SHADOW_MAX_CONTEXT_CHARS +
      NARROW_SHADOW_MAX_CONTEXT_CHARS;
    const charBound = structuralChars + boundedTextChars;
    const tokenCeiling = Math.ceil(charBound / 3);
    const packet = JSON.parse(await readFile('docs/jev-usage-lab/narrow-shadow-request-bound.v1.json', 'utf8'));
    assert.equal(packet.planningEstimatedUsdPerCall, 0.002);
    assert.equal(packet.runtimeEstimatedUsdPerCall, null);
    assert.equal(packet.runtimeUnsetMeansNoCall, true);
    assert.equal(packet.loadConfigInjectsPlanningEstimate, false);
    assert.equal(packet.accountVerified, false);
    assert.equal(packet.testShape.notAUniversalCeiling, true);
    assert.equal(packet.testShape.label, 'short_identifiers_in_title_cap_regression');
    assert.equal(charBound, packet.testShape.charBound);
    assert.equal(tokenCeiling, packet.testShape.planningTMax);
    assert.notEqual(packet.testShape.charBound, packet.universal.charBound);
    assert.equal(packet.notAUniversalHardCeiling.includes(3004), true);
    assert.notEqual(3004, packet.universal.charBound);
    assert.notEqual(3004, packet.universal.planningTMax);
    assert.equal(serialized.length, charBound);
    assert.ok(serialized.length <= charBound);
    assert.ok(Math.ceil(serialized.length / 3) <= tokenCeiling);
    assert.equal(serialized.includes('T'.repeat(NARROW_SHADOW_MAX_TITLE_CHARS + 1)), false);
    const uncappedTitleChars = rawTitle.length;
    assert.ok(
      structuralChars +
        uncappedTitleChars +
        NARROW_SHADOW_MAX_SPAN_CHARS +
        NARROW_SHADOW_MAX_CONTEXT_CHARS * 2 >
        charBound
    );

    const missingTitle = await buildNarrowShadowReport({
      enabled: true,
      graph: {
        ...graph,
        artifact: { ...graph.artifact, title: null },
        spans: [{ id: 'span-1', role: 'authorial', role_basis: 'default', text: 'Short span.' }]
      },
      articleHint: { mode: 'url' },
      limits: {
        maxCallsPerAnalysis: 5,
        timeoutMs: 10000,
        rateLimitPerMinute: 6,
        monthlyCostCeilingUsd: 5,
        estimatedUsdPerCall: 0.01
      },
      provider: {
        async ask(request) {
          seen.push(request);
          return {
            ok: true,
            model_reported: 'jev-1.13.0',
            answers: answersFor(questionSet, NARROW_MOCK_CHOICES)
          };
        }
      },
      providerKind: 'injected_mock',
      liveNetworkPermitted: false,
      recordedAt: RECORDED_AT
    });
    assert.equal(missingTitle.network_calls, 1);
    const nullTitle = seen.find((request) => request.span_id === 'span-1');
    assert.equal(nullTitle.state.artifact.title, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});

test('universal narrow body uses maximum safe ids and matches the planning packet', async () => {
  assert.equal(NARROW_SHADOW_MAX_SAFE_ID_CHARS, 128);
  assert.equal(NARROW_SHADOW_APPROVED_OPERATING_POINTS.estimatedUsdPerCall, 0.002);
  assert.equal(process.env.MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL, undefined);
  assert.equal(process.env.MEDIA_LENS_TYPESAFE_API_KEY, undefined);
  assert.equal(process.env.MEDIA_LENS_ENABLE_LIVE, undefined);

  const packet = JSON.parse(await readFile('docs/jev-usage-lab/narrow-shadow-request-bound.v1.json', 'utf8'));
  const schema = JSON.parse(await readFile('media-lens/schema/influence-graph.v1.json', 'utf8'));
  assert.deepEqual([...NARROW_SHADOW_ARTIFACT_KINDS], schema.properties.artifact.properties.kind.enum);
  const longest = (values) => [...values].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
  const kind = longest(NARROW_SHADOW_ARTIFACT_KINDS);
  const role = longest(SPAN_ROLES);
  assert.equal(kind, packet.universal.kind);
  assert.equal(role, packet.universal.spanRole);
  assert.equal(kind, 'other_public');
  assert.equal(role, 'attributed_paraphrase');

  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const maxId = (char) => char.repeat(NARROW_SHADOW_MAX_SAFE_ID_CHARS);
  const articleId = maxId('a');
  const sourceId = maxId('d');
  const beforeId = maxId('b');
  const spanId = maxId('m');
  const afterId = maxId('c');
  const graph = {
    graph_id: RUN_ID,
    artifact: {
      title: 'T'.repeat(NARROW_SHADOW_MAX_TITLE_CHARS + 50),
      text_sha256: TEXT_SHA,
      publisher: { domain: sourceId },
      kind
    },
    spans: [
      { id: beforeId, role: 'authorial', role_basis: 'default', text: 'B'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 25) },
      { id: spanId, role, role_basis: 'default', text: 'M'.repeat(NARROW_SHADOW_MAX_SPAN_CHARS + 25) },
      { id: afterId, role: 'authorial', role_basis: 'default', text: 'A'.repeat(NARROW_SHADOW_MAX_CONTEXT_CHARS + 25) }
    ],
    observations: [],
    claims: [],
    abstentions: [],
    engine: { jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls: 0 } }
  };

  const seen = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('universal bound test must not use the network');
  };
  try {
    const report = await buildNarrowShadowReport({
      enabled: true,
      graph,
      articleHint: { mode: 'fixture', fixtureId: articleId },
      limits: {
        maxCallsPerAnalysis: NARROW_SHADOW_APPROVED_OPERATING_POINTS.maxCallsPerAnalysis,
        timeoutMs: NARROW_SHADOW_APPROVED_OPERATING_POINTS.timeoutMs,
        rateLimitPerMinute: NARROW_SHADOW_APPROVED_OPERATING_POINTS.rateLimitPerMinute,
        monthlyCostCeilingUsd: NARROW_SHADOW_APPROVED_OPERATING_POINTS.monthlyCostCeilingUsd,
        estimatedUsdPerCall: 0.01
      },
      provider: {
        async ask(request) {
          seen.push(request);
          return {
            ok: true,
            model_reported: 'jev-1.13.0',
            answers: answersFor(questionSet, NARROW_MOCK_CHOICES)
          };
        }
      },
      providerKind: 'injected_mock',
      liveNetworkPermitted: false,
      liveNetworkBlockReason: 'fixture_mode',
      recordedAt: RECORDED_AT
    });
    assert.equal(fetchCalls, 0);
    assert.equal(report.network_calls, 3);
    assert.equal(report.retention, 'stderr_process_log_only_no_disk_store');
    assert.equal(report.cost.production_budget_written, false);

    const middle = seen.find((request) => request.span_id === spanId);
    const body = narrowLiveRequestBody(packet.universal.model, middle);
    const serialized = JSON.stringify(body);
    assert.equal(body.state.artifact.title.length, NARROW_SHADOW_MAX_TITLE_CHARS);
    assert.equal(body.state.span.text.length, NARROW_SHADOW_MAX_SPAN_CHARS);
    assert.equal(body.state.context.before.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
    assert.equal(body.state.context.after.length, NARROW_SHADOW_MAX_CONTEXT_CHARS);
    assert.equal(body.state.provenance.article_id.length, NARROW_SHADOW_MAX_SAFE_ID_CHARS);
    assert.equal(body.state.provenance.source_id.length, NARROW_SHADOW_MAX_SAFE_ID_CHARS);
    assert.equal(body.state.provenance.span_id.length, NARROW_SHADOW_MAX_SAFE_ID_CHARS);
    assert.equal(body.state.span.id.length, NARROW_SHADOW_MAX_SAFE_ID_CHARS);
    assert.deepEqual(body.state.provenance.source_ids, [sourceId]);
    assert.equal(body.state.artifact.kind, kind);
    assert.equal(body.state.span.role, role);
    assert.equal(body.state.provenance.span_role, role);
    assert.equal(Object.keys(body.questions).length, 7);
    assert.equal(serialized.length, packet.universal.charBound);
    assert.equal(Math.ceil(serialized.length / 3), packet.universal.planningTMax);
    assert.equal(packet.universal.planningTMax, Math.ceil(packet.universal.charBound / 3));
    assert.equal(packet.universal.charBound, 9467);
    assert.equal(packet.universal.planningTMax, 3156);
    assert.equal(packet.planningEstimatedUsdPerCall, NARROW_SHADOW_APPROVED_OPERATING_POINTS.estimatedUsdPerCall);
    assert.equal(packet.planningEstimatedUsdPerCall, 0.002);
    assert.equal(packet.runtimeEstimatedUsdPerCall, null);
    assert.equal(packet.runtimeUnsetMeansNoCall, true);
    assert.equal(packet.loadConfigInjectsPlanningEstimate, false);
    assert.equal(packet.accountVerified, false);
    assert.equal(packet.providerMeasured, false);
    assert.equal(packet.publicListPriceUsdPerMillionInputTokens, 0.042);
    assert.equal(packet.planningBufferFraction, 0.2);
    assert.equal(packet.rawBufferedUsdPerCallApprox, '0.000159');
    assert.equal(packet.maxFiveCallAnalysisEstimateUsd, 0.01);
    const rawUsd = (packet.universal.planningTMax * packet.publicListPriceUsdPerMillionInputTokens) / 1_000_000;
    const bufferedUsd = rawUsd * (1 + packet.planningBufferFraction);
    assert.ok(Math.abs(bufferedUsd - 0.0001590624) < 1e-12);
    assert.ok(bufferedUsd < packet.planningEstimatedUsdPerCall);
    assert.equal(packet.planningEstimatedUsdPerCall * 5, packet.maxFiveCallAnalysisEstimateUsd);
    const executionDoc = await readFile('docs/jev-usage-lab/10-narrow-shadow-execution.md', 'utf8');
    assert.match(executionDoc, /A shared ledger is required before multi-worker or restart-safe standing enablement/);
    assert.match(executionDoc, /loadConfig` does not apply 0\.002/);
    assert.match(executionDoc, /does not inject it/);
    assert.ok(packet.universal.charBound > packet.testShape.charBound);
    assert.notEqual(3004, packet.universal.charBound);
    assert.notEqual(3004, packet.universal.planningTMax);

    const tooLongId = 'z'.repeat(NARROW_SHADOW_MAX_SAFE_ID_CHARS + 1);
    const rejected = [];
    await buildNarrowShadowReport({
      enabled: true,
      graph: {
        graph_id: RUN_ID,
        artifact: {
          title: 'Title',
          text_sha256: TEXT_SHA,
          publisher: { domain: 'example.com' },
          kind: 'other_public_extra'
        },
        spans: [
          { id: tooLongId, role: 'authorial', role_basis: 'default', text: 'Rejected span.' },
          { id: 'span-ok', role: 'r'.repeat(200), role_basis: 'default', text: 'Kept span.' }
        ],
        observations: [],
        claims: [],
        abstentions: [],
        engine: { jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls: 0 } }
      },
      articleHint: { mode: 'url' },
      limits: {
        maxCallsPerAnalysis: 5,
        timeoutMs: 10000,
        rateLimitPerMinute: 6,
        monthlyCostCeilingUsd: 5,
        estimatedUsdPerCall: 0.01
      },
      provider: {
        async ask(request) {
          rejected.push(request);
          return {
            ok: true,
            model_reported: 'jev-1.13.0',
            answers: answersFor(questionSet, NARROW_MOCK_CHOICES)
          };
        }
      },
      providerKind: 'injected_mock',
      recordedAt: RECORDED_AT
    });
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].span_id, 'span-ok');
    assert.equal(rejected.some((request) => request.span_id === tooLongId), false);
    assert.equal(rejected.some((request) => request.span_id === tooLongId.slice(0, NARROW_SHADOW_MAX_SAFE_ID_CHARS)), false);
    const rejectedBody = narrowLiveRequestBody(packet.universal.model, rejected[0]);
    assert.equal(rejectedBody.state.artifact.kind, null);
    assert.equal(rejectedBody.state.span.role, null);
    assert.equal(rejectedBody.state.provenance.span_role, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});
