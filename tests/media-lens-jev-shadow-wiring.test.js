import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig, publicConfig } from '../media-lens/worker/config.js';
import { loadQuestionSet } from '../media-lens/worker/adapters/jev.js';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { normalizeForGolden } from '../media-lens/schema/golden.js';
import { validateContractSchema } from '../media-lens/worker/jev-usage-lab/schema-check.js';
import {
  SHADOW_EXTRA_JEV_CALLS_ENABLED,
  armAnalyzeShadow,
  articleIdFromAnalyze,
  buildAnalyzeShadowReport,
  projectGraphForShadow,
  scheduleAnalyzeShadow
} from '../media-lens/worker/jev-usage-lab/analyze-shadow.js';

const CONSENT_AT = '2026-09-18T00:00:00.000Z';
const RECORDED_AT = '2026-09-22T00:00:00.000Z';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_SHA = 'ab'.repeat(32);

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

function fixtureBody(fixtureId) {
  return {
    user_asserted_public: true,
    mode: 'fixture',
    fixture_id: fixtureId,
    consent_at: CONSENT_AT
  };
}

function stableGraph(graph) {
  return JSON.stringify(normalizeForGolden(graph));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function graphWith({ spans, observations = [], claims = [], calls = 1, abstentions = [] }) {
  return {
    graph_id: RUN_ID,
    artifact: {
      title: 'Council approves downtown drainage upgrade',
      url: 'https://user:sk-supersecretvalue@secret.example/private-article',
      byline: 'Jordan Reyes',
      text_sha256: TEXT_SHA,
      publisher: { domain: 'example.com' }
    },
    spans,
    observations,
    claims,
    abstentions,
    engine: {
      jev: { mode: 'fixture', model_reported: 'jev-1.13.0', calls }
    }
  };
}

function jevResult(answer, calls = 1) {
  return {
    answersBySpanId: new Map([['span-1', answer]]),
    failedSpanIds: new Set(),
    calls,
    failures: 0,
    modelReported: 'jev-1.13.0'
  };
}

function choice(choiceId, probability, otherId = null, otherProbability = null) {
  const probabilities = { [choiceId]: probability };
  if (otherId) probabilities[otherId] = otherProbability;
  return {
    type: 'choice',
    choice: choiceId,
    probabilities,
    confidence: probability,
    api_key: 'sk-supersecretvalue',
    text: 'downtown drainage upgrade'
  };
}

async function reportFor(graph, result, { elapsedMs = 4 } = {}) {
  return buildAnalyzeShadowReport({
    graph,
    capture: { take: () => ({ sawResult: true, result }) },
    articleHint: { mode: 'fixture', fixtureId: 'synthetic-01-quoted-vs-authorial' },
    jevMode: 'fixture',
    recordedAt: RECORDED_AT,
    elapsedMs
  });
}

test('shadow flag is exact, default off, and absent from public config', () => {
  const unset = loadConfig({});
  assert.equal(unset.jevShadow.enabled, false);
  assert.equal(unset.jevShadow.extraJevCallsEnabled, false);
  assert.equal(loadConfig({ MEDIA_LENS_JEV_SHADOW: 'TRUE' }).jevShadow.enabled, false);
  assert.equal(loadConfig({ MEDIA_LENS_JEV_SHADOW: '1' }).jevShadow.enabled, false);
  assert.equal(loadConfig({ MEDIA_LENS_JEV_SHADOW: 'true ' }).jevShadow.enabled, false);
  const enabled = loadConfig({ MEDIA_LENS_JEV_SHADOW: 'true' });
  assert.equal(enabled.jevShadow.enabled, true);
  assert.equal(enabled.jevShadow.extraJevCallsEnabled, false);
  assert.equal(enabled.liveEnabled, false);
  assert.equal(enabled.liveUrlEnabled, false);
  assert.equal(enabled.classifierDev.enabled, false);
  assert.equal(enabled.mode, 'fixture');
  assert.equal(SHADOW_EXTRA_JEV_CALLS_ENABLED, false);
  assert.deepEqual(publicConfig(unset), publicConfig(enabled));
  assert.equal(JSON.stringify(publicConfig(enabled)).includes('jevShadow'), false);
  assert.equal(articleIdFromAnalyze({ mode: 'fixture', fixtureId: 'synthetic-01-quoted-vs-authorial' }), 'synthetic-01-quoted-vs-authorial');
  assert.equal(articleIdFromAnalyze({ mode: 'fixture', fixtureId: '../etc/passwd', textSha256: TEXT_SHA }), TEXT_SHA);
  assert.equal(articleIdFromAnalyze({ mode: 'pasted_text', textSha256: TEXT_SHA }), TEXT_SHA);
  assert.equal(articleIdFromAnalyze({ mode: 'url', fixtureId: 'https://secret.example/a' }), null);
});

test('disabled arm does not read the graph or schedule shadow', async () => {
  let sinkCalls = 0;
  const graph = new Proxy({}, { get() { throw new Error('shadow read a disabled graph'); } });
  const armed = armAnalyzeShadow({
    enabled: false,
    graph,
    sink() {
      sinkCalls += 1;
    }
  });
  assert.equal(armed.scheduled, false);
  assert.equal(armed.network_calls, 0);
  assert.equal(await armed.done, null);
  assert.equal(sinkCalls, 0);
});

test('shadow records abstain, disagree, and stay deterministic without network or article text', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = function countedFetch(...args) {
    fetchCalls += 1;
    return originalFetch.apply(this, args);
  };
  try {
    const lowGraph = deepFreeze(
      graphWith({
        spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure', text: 'downtown drainage upgrade' }],
        observations: [{ signal: 'loaded_moralized', strength: 'candidate', span_ids: ['span-1'], evidence: { engine: 'jev' } }],
        claims: [{ span_ids: ['span-1'], support: 'not_checked', text: 'downtown drainage upgrade' }]
      })
    );
    const low = await reportFor(
      lowGraph,
      jevResult({
        influence_signal: choice('loaded_moralized', 0.5, 'none', 0.4),
        is_quoted_or_attributed: { type: 'noul', noul: 0.1, api_key: 'sk-supersecretvalue' }
      })
    );
    assert.equal(low.records[0].disagreement_class, 'shadow_abstain');
    assert.equal(low.records[0].influence.abstained, true);
    assert.equal(low.records[0].influence.abstention_reason, 'low_margin');
    assert.equal(low.records[0].influence.selected_option, null);
    assert.equal(low.records[0].influence.measurement.basis, 'in_process');
    assert.equal(low.records[0].influence.measurement.call_count, 0);
    assert.equal(low.records[0].claim_disagreement_class, 'agree');
    assert.equal(low.records[0].influence.claim_support_applied, false);
    assert.equal(low.records[0].influence.role_write_authorized, false);
    assert.equal(low.records[0].influence.acted, false);
    assert.equal(lowGraph.observations[0].strength, 'candidate');

    const signalGraph = graphWith({
      spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure' }],
      observations: [{ signal: 'urgency', strength: 'observed', span_ids: ['span-1'], evidence: { engine: 'jev' } }]
    });
    const signal = await reportFor(signalGraph, jevResult({
      influence_signal: choice('loaded_moralized', 0.8, 'none', 0.1),
      is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
    }));
    assert.equal(signal.records[0].disagreement_class, 'signal');
    assert.equal(signalGraph.observations[0].signal, 'urgency');

    const strengthGraph = graphWith({
      spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure' }],
      observations: [{ signal: 'certainty_beyond_evidence', strength: 'observed', span_ids: ['span-1'], evidence: { engine: 'jev' } }]
    });
    const strength = await reportFor(strengthGraph, jevResult({
      influence_signal: choice('certainty_beyond_evidence', 0.8, 'none', 0.1),
      is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
    }));
    assert.equal(strength.records[0].disagreement_class, 'strength');
    assert.equal(strength.records[0].influence.evidence_strength, 'candidate');
    assert.equal(strengthGraph.observations[0].strength, 'observed');

    const roleGraph = graphWith({
      spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure' }],
      observations: []
    });
    const role = await reportFor(roleGraph, jevResult({
      influence_signal: choice('none', 0.9),
      is_quoted_or_attributed: { type: 'noul', noul: 0.95 }
    }));
    assert.equal(role.records[0].role_disagreement_class, 'role_recommendation_withheld');
    assert.equal(role.records[0].quoted.role_write_authorized, false);
    assert.equal(role.records[0].quoted.role_effect, 'authorial_to_uncertain');
    assert.equal(roleGraph.spans[0].role, 'authorial');

    const claimGraph = graphWith({
      spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure' }],
      claims: [{ span_ids: ['span-1'], support: 'supported', text: 'downtown drainage upgrade' }]
    });
    const claim = await reportFor(claimGraph, jevResult({
      influence_signal: choice('none', 0.9),
      is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
    }));
    assert.equal(claim.records[0].claim_disagreement_class, 'claim_support');
    assert.equal(claim.claim_support_applied, false);
    assert.equal(claimGraph.claims[0].support, 'supported');

    const again = await reportFor(lowGraph, jevResult({
      influence_signal: choice('loaded_moralized', 0.5, 'none', 0.4),
      is_quoted_or_attributed: { type: 'noul', noul: 0.1, api_key: 'sk-supersecretvalue' }
    }));
    assert.deepEqual(low, again);
    assert.equal(low.label, 'fixture_replay');
    assert.equal(low.not_model_accuracy, true);
    assert.equal(low.network_calls, 0);
    assert.equal(low.extra_jev_calls, 0);
    assert.equal(low.extra_jev_calls_enabled, false);
    assert.equal(low.narrow_question_set.asked, false);
    assert.equal(low.holdout_scored, false);
    assert.equal(low.fixture_manifest_loaded, false);
    assert.equal(low.splits_scored, false);
    assert.equal(low.cross_span_batched, false);
    assert.equal(low.http_calls, 0);
    assert.equal(low.cost.available, false);
    const serialized = JSON.stringify(low);
    assert.doesNotMatch(serialized, /sk-supersecretvalue/);
    assert.doesNotMatch(serialized, /downtown drainage/);
    assert.doesNotMatch(serialized, /Jordan Reyes/);
    assert.doesNotMatch(serialized, /https:\/\//);
    assert.doesNotMatch(serialized, /model accuracy/i);
    assert.equal(fetchCalls, 0);

    const loaded = await loadQuestionSet();
    assert.equal(low.question_set_sha256, loaded.sha256);
    assert.equal(low.records[0].analysis_run_id, RUN_ID);
    assert.equal(low.records[0].influence.provenance.article_id, 'synthetic-01-quoted-vs-authorial');
    assert.equal(low.records[0].influence.provenance.span_id, 'span-1');
    assert.equal(low.records[0].influence.provenance.source_id, 'example.com');
    assert.equal(low.records[0].question_set_id, 'influence-questions.v1');
    assert.equal(low.records[0].question_set_version, '1');
    assert.equal(low.deployment_sha, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shadow build failure and sink failure stay off the result and omit secrets', async () => {
  const seen = [];
  const failed = scheduleAnalyzeShadow({
    enabled: true,
    input: {},
    build: async () => {
      throw new Error('sk-supersecretvalue downtown drainage upgrade');
    },
    sink(report) {
      seen.push(report);
    }
  });
  const failedStatus = await failed.done;
  assert.equal(failedStatus.ok, false);
  assert.equal(failedStatus.network_calls, 0);
  assert.equal(failedStatus.acted, false);
  assert.equal(seen[0].shadow_failed, true);
  assert.equal(seen[0].records.length, 0);
  assert.doesNotMatch(JSON.stringify(seen), /sk-supersecretvalue/);
  assert.doesNotMatch(JSON.stringify(seen), /downtown drainage/);

  const thrown = scheduleAnalyzeShadow({
    enabled: true,
    input: { graph: null, articleHint: { mode: 'fixture', fixtureId: 'nope' }, jevMode: 'fixture', elapsedMs: 0, recordedAt: RECORDED_AT },
    sink() {
      throw new Error('sk-supersecretvalue');
    }
  });
  const thrownStatus = await thrown.done;
  assert.equal(thrownStatus.shadow_failed, true);
  assert.equal(thrownStatus.acted, false);
  assert.equal(thrownStatus.network_calls, 0);
});

test('missing provenance produces no shadow answer', async () => {
  const report = await buildAnalyzeShadowReport({
    graph: { graph_id: 'not-a-run', spans: [{ id: 'span-1', text: 'downtown drainage upgrade' }] },
    articleHint: { mode: 'url' },
    jevMode: 'fixture',
    elapsedMs: 1,
    recordedAt: RECORDED_AT
  });
  assert.equal(report.records.length, 0);
  assert.equal(report.refused, 'missing_provenance');
  assert.equal(report.network_calls, 0);
  assert.equal(report.not_model_accuracy, true);
  assert.doesNotMatch(JSON.stringify(report), /downtown drainage/);
});

test('projection drops article text before a record is built', () => {
  const projected = projectGraphForShadow({
    graph_id: RUN_ID,
    artifact: {
      title: 'downtown drainage upgrade',
      url: 'https://secret.example/a?token=1',
      byline: 'Jordan Reyes',
      text_sha256: TEXT_SHA,
      publisher: { domain: 'example.com' }
    },
    spans: [{ id: 'span-1', role: 'authorial', role_basis: 'html_structure', text: 'downtown drainage upgrade' }],
    observations: [{ signal: 'urgency', strength: 'observed', span_ids: ['span-1'], evidence: { engine: 'jev' }, ui_phrase: 'downtown drainage upgrade' }],
    claims: [{ span_ids: ['span-1'], support: 'not_checked', text: 'downtown drainage upgrade' }],
    abstentions: [{ reason: 'insufficient_text', scope: 'graph', message: 'downtown drainage upgrade' }]
  });
  assert.doesNotMatch(JSON.stringify(projected), /downtown drainage/);
  assert.doesNotMatch(JSON.stringify(projected), /token=1/);
  assert.equal(projected.artifact.publisher_domain, 'example.com');
  assert.equal(projected.observations[0].signal, 'urgency');
});

test('runtime module does not import live, holdout, or extra-call paths', async () => {
  const source = await readFile('media-lens/worker/jev-usage-lab/analyze-shadow.js', 'utf8');
  assert.doesNotMatch(source, /safe-fetch|classifier-dev|caddy|createJevAdapter|process\.env|manifest\.json|runUsageLab|evaluateLab|replayHistoricalFixtures|TYPESAFE_API_KEY/);
  const serverSource = await readFile('media-lens/worker/server.js', 'utf8');
  assert.equal(serverSource.includes('extraJevCallsEnabled'), false);
  assert.equal(serverSource.includes('final_action'), false);
  const analyzeSource = await readFile('media-lens/worker/analyze.js', 'utf8');
  assert.equal(analyzeSource.includes('jev-usage-lab'), false);
});

test('disabled /analyze matches the unwired fixture baseline and makes zero shadow calls', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = function countedFetch(...args) {
    fetchCalls += 1;
    return originalFetch.apply(this, args);
  };
  const seen = [];
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture', MEDIA_LENS_JEV_SHADOW: 'false' });
  const server = await listen(createServer(config, { shadowSink: (report) => seen.push(report) }));
  try {
    const health = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(Object.hasOwn(health.body, 'jevShadow'), false);
    const res = await requestJson(server, { method: 'POST', path: '/analyze', body: fixtureBody('synthetic-01-quoted-vs-authorial') });
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const baseline = await runFixture('synthetic-01-quoted-vs-authorial');
    assert.equal(stableGraph(res.body), stableGraph(baseline));
    assert.equal(res.body.engine.jev.calls, 6);
    assert.equal(res.body.claims.every((claim) => claim.support === 'not_checked'), true);
    assert.equal(seen.length, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(Object.hasOwn(res.body, 'shadow_enabled'), false);
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});

test('enabled /analyze keeps the production body, logs provenance, and survives shadow failure', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = function countedFetch(...args) {
    fetchCalls += 1;
    return originalFetch.apply(this, args);
  };
  const schema = JSON.parse(await readFile('schemas/jev-decision-contract.v1.json', 'utf8'));
  const recorded = [];
  const typesafeBudget = {
    isStopped() {
      return false;
    },
    wouldExceed() {
      return false;
    },
    recordCalls(count) {
      recorded.push(count);
      return { shouldWarn: false };
    }
  };
  const seen = [];
  let releaseSink = () => {};
  const sinkGate = new Promise((resolve) => {
    releaseSink = resolve;
  });
  let sinkReleased = false;
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture', MEDIA_LENS_JEV_SHADOW: 'true' });
  const server = await listen(
    createServer(config, {
      typesafeBudget,
      shadowSink(report) {
        seen.push(report);
        return sinkGate.then(() => {
          sinkReleased = true;
        });
      }
    })
  );
  try {
    const offServer = await listen(createServer(loadConfig({ MEDIA_LENS_MODE: 'fixture' })));
    try {
      const healthOn = await requestJson(server, { method: 'GET', path: '/health' });
      const healthOff = await requestJson(offServer, { method: 'GET', path: '/health' });
      assert.deepEqual(healthOn.body, healthOff.body);

      const res = await Promise.race([
        requestJson(server, { method: 'POST', path: '/analyze', body: fixtureBody('synthetic-01-quoted-vs-authorial') }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('analyze waited on shadow')), 2000))
      ]);
      assert.equal(res.status, 200);
      assert.equal(sinkReleased, false);
      const off = await requestJson(offServer, { method: 'POST', path: '/analyze', body: fixtureBody('synthetic-01-quoted-vs-authorial') });
      const baseline = await runFixture('synthetic-01-quoted-vs-authorial');
      assert.equal(stableGraph(res.body), stableGraph(off.body));
      assert.equal(stableGraph(res.body), stableGraph(baseline));
      assert.equal(res.body.engine.jev.calls, baseline.engine.jev.calls);
      assert.equal(recorded.length, 0);
      assert.equal(fetchCalls, 0);

      const deadline = Date.now() + 1000;
      while (seen.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(seen.length, 1);
      const report = seen[0];
      assert.equal(report.shadow_enabled, true);
      assert.equal(report.not_model_accuracy, true);
      assert.equal(report.label, 'fixture_replay');
      assert.equal(report.network_calls, 0);
      assert.equal(report.call_count, 0);
      assert.equal(report.extra_jev_calls, 0);
      assert.equal(report.extra_jev_calls_enabled, false);
      assert.equal(report.narrow_question_set.asked, false);
      assert.equal(report.production_jev_calls, 6);
      assert.equal(report.captured_calls, 6);
      assert.equal(report.cross_span_batched, false);
      assert.equal(report.http_calls, 0);
      assert.equal(report.provenance_plan_ok, true);
      assert.equal(report.holdout_scored, false);
      assert.equal(report.fixture_manifest_loaded, false);
      assert.equal(report.acted, false);
      assert.equal(report.claim_support_applied, false);
      assert.equal(report.role_write_authorized, false);
      assert.equal(report.analysis_run_id, res.body.graph_id);
      assert.equal(report.article_id, 'synthetic-01-quoted-vs-authorial');
      assert.equal(report.question_set_id, 'influence-questions.v1');
      assert.equal(report.question_set_version, '1');
      assert.equal(report.question_set_sha256, res.body.engine.jev.question_set_sha256);
      assert.equal(report.model_requested, 'jev-1.13.0');
      assert.equal(report.deployment_sha, null);
      assert.equal(report.retention, 'stderr_process_log_only_no_disk_store');
      assert.ok(report.decision_count > 1);
      assert.equal(report.planned_request_count, report.decision_count);
      const spanIds = report.records.map((row) => row.span_id);
      assert.equal(new Set(spanIds).size, spanIds.length);
      for (const row of report.records) {
        assert.equal(row.analysis_run_id, res.body.graph_id);
        assert.equal(row.article_id, 'synthetic-01-quoted-vs-authorial');
        assert.equal(row.span_id, row.influence.provenance.span_id);
        assert.equal(row.quoted.provenance.span_id, row.span_id);
        assert.equal(row.influence.audit.deployment_sha, null);
        assert.equal(row.influence.measurement.call_count, 0);
        assert.equal(row.influence.measurement.basis, 'in_process');
        assert.equal(row.influence.acted, false);
        assert.equal(row.influence.claim_support_applied, false);
        assert.equal(row.influence.role_write_authorized, false);
        assert.equal(row.shadow_decision.claim_support_applied, false);
        assert.equal(row.shadow_decision.role_write_authorized, false);
        assert.equal(row.claim_disagreement_class, 'agree');
        assert.deepEqual(validateContractSchema(schema, row.influence), []);
        assert.deepEqual(validateContractSchema(schema, row.quoted), []);
      }
      const serialized = JSON.stringify(report);
      assert.doesNotMatch(serialized, /downtown drainage/);
      assert.doesNotMatch(serialized, /Jordan Reyes/);
      assert.doesNotMatch(serialized, /sk-/);
      assert.doesNotMatch(serialized, /https:\/\//);
      assert.match(JSON.stringify(res.body), /downtown drainage/);
      assert.equal(Object.hasOwn(res.body, 'shadow_enabled'), false);
      releaseSink();
      await sinkGate;
      assert.equal(sinkReleased, true);
    } finally {
      releaseSink();
      offServer.close();
    }

    const pasted = 'SENTINEL_PRIVATE_PASTE_'.repeat(20);
    const pasteSeen = [];
    const pasteServer = await listen(
      createServer(config, {
        shadowSink(report) {
          pasteSeen.push(report);
        }
      })
    );
    try {
      const pasteRes = await requestJson(pasteServer, {
        method: 'POST',
        path: '/analyze',
        body: { user_asserted_public: true, mode: 'pasted_text', text: pasted, consent_at: CONSENT_AT }
      });
      assert.equal(pasteRes.status, 200);
      const deadline = Date.now() + 1000;
      while (pasteSeen.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(pasteSeen.length, 1);
      assert.equal(pasteSeen[0].article_id, pasteRes.body.artifact.text_sha256);
      assert.doesNotMatch(JSON.stringify(pasteSeen[0]), /SENTINEL_PRIVATE_PASTE_/);
      assert.equal(pasteSeen[0].network_calls, 0);
    } finally {
      pasteServer.close();
    }

    let failed = false;
    const failServer = await listen(
      createServer(config, {
        shadowSink() {
          failed = true;
          throw new Error('sk-supersecretvalue downtown drainage');
        }
      })
    );
    try {
      const failRes = await requestJson(failServer, {
        method: 'POST',
        path: '/analyze',
        body: fixtureBody('synthetic-06-short-excerpt')
      });
      assert.equal(failRes.status, 200);
      const baseline = await runFixture('synthetic-06-short-excerpt');
      assert.equal(stableGraph(failRes.body), stableGraph(baseline));
      assert.equal(failRes.body.engine.jev.calls, 0);
      const deadline = Date.now() + 1000;
      while (!failed && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(failed, true);
      assert.doesNotMatch(failRes.raw, /sk-supersecretvalue/);
    } finally {
      failServer.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});
