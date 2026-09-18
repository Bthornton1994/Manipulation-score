import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../media-lens/schema/validate.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function baseGraph() {
  return {
    schema: 'influence-graph.v1',
    graph_id: 'test-graph-0001',
    generated_at: '2026-09-18T00:00:00.000Z',
    artifact: {
      kind: 'article',
      input_mode: 'fixture',
      url: null,
      canonical_url: null,
      title: 'A synthetic headline',
      byline: 'Jordan Reyes',
      publisher: { name: 'Fictional Daily', domain: 'fictional-daily.example' },
      published_at: '2026-09-17T10:00:00.000Z',
      modified_at: null,
      timestamp_precision: 'time',
      language: 'en',
      text_sha256: 'a'.repeat(64),
      text_length_chars: 500,
      paywall_detected: false,
      authorization: { user_asserted_public: true, consent_at: '2026-09-18T00:00:00.000Z' }
    },
    spans: [
      { id: 'span-1', start: 0, end: 20, text: 'Officials say chaos looms.', paragraph_index: 0, role: 'headline', attribution: { speaker: null, cue: null }, role_basis: 'html_structure' },
      { id: 'span-2', start: 21, end: 60, text: '"We will act," the mayor said.', paragraph_index: 1, role: 'quoted', attribution: { speaker: 'the mayor', cue: 'said' }, role_basis: 'quote_marks' },
      { id: 'span-3', start: 61, end: 100, text: 'The council voted on Tuesday.', paragraph_index: 2, role: 'authorial', attribution: { speaker: null, cue: null }, role_basis: 'default' }
    ],
    observations: [
      {
        id: 'obs-1',
        dimension: 'language',
        signal: 'vague_authority',
        strength: 'observed',
        localization: 'span',
        span_ids: ['span-1'],
        authorial_attribution: 'authorial',
        evidence: { engine: 'jev', question_id: 'influence_signal', top_probability: 0.82, answers_ref: 'span-1' },
        review_status: 'auto',
        ui_phrase: 'Observed influence signal'
      },
      {
        id: 'obs-2',
        dimension: 'language',
        signal: 'urgency',
        strength: 'candidate',
        localization: 'span',
        span_ids: ['span-2'],
        authorial_attribution: 'quoted',
        evidence: { engine: 'jev', question_id: 'influence_signal', top_probability: 0.55, answers_ref: 'span-2' },
        review_status: 'auto',
        ui_phrase: 'Quoted language not attributed as authorial'
      }
    ],
    claims: [
      {
        id: 'claim-1',
        span_ids: ['span-3'],
        text: 'The council voted on Tuesday.',
        kind: 'event',
        attribution: 'authorial',
        support: 'not_checked',
        support_evidence: [],
        review_status: 'auto'
      }
    ],
    coverage: {
      status: 'not_requested',
      provenance: 'none',
      story_origin: null,
      freshness_gate: null,
      cluster: null,
      frames: [],
      confidence: 'low'
    },
    source_context: {
      shown_separately: true,
      publisher: { name: 'Fictional Daily', domain: 'fictional-daily.example' },
      canonical_domain: 'fictional-daily.example',
      metadata: { has_byline: true, has_published_time: true, has_canonical: false, syndication_markers: [] },
      third_party_ratings: [],
      note: 'Source context is metadata, not a manipulation judgment.'
    },
    abstentions: [],
    engine: {
      pipeline_version: 'media-lens-0.1.0',
      preparation: { version: '0.1.0', extractor: 'fixture' },
      jev: {
        mode: 'fixture',
        model_requested: 'jev-1.13.0',
        model_reported: 'jev-1.13.0',
        model_match: true,
        question_set: 'influence-questions.v1',
        question_set_sha256: 'b'.repeat(64),
        calls: 3,
        failures: 0,
        elapsed_ms: 12
      },
      newsjack: { mode: 'fixture', version: null, artifacts: [] },
      fusion: {
        version: '0.1.0',
        thresholds: { observed_min_probability: 0.6, candidate_min_probability: 0.45, quoted_agreement_min: 0.7, failure_rate_abstain: 0.2 }
      },
      timestamps: { started_at: '2026-09-18T00:00:00.000Z', completed_at: '2026-09-18T00:00:01.000Z' }
    },
    privacy: {
      external_processing: [],
      clarity_isolation: 'no_private_message_path',
      full_text_persisted: false,
      spans_included: 'all',
      retention: 'none',
      disclosure_shown: true
    }
  };
}

test('a well-formed minimal graph validates', () => {
  const { valid, errors } = validate(baseGraph());
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('invariant 1: span-localized observation must reference an existing span', () => {
  const graph = baseGraph();
  graph.observations[0].span_ids = ['does-not-exist'];
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('unknown span id')));
});

test('invariant 1: unlocalized observation must be a candidate with empty span_ids', () => {
  const graph = baseGraph();
  graph.observations.push({
    id: 'obs-3',
    dimension: 'language',
    signal: 'bandwagon',
    strength: 'observed',
    localization: 'unlocalized',
    span_ids: [],
    authorial_attribution: 'unknown',
    evidence: { engine: 'jev', question_id: null, top_probability: null, answers_ref: null },
    review_status: 'auto',
    ui_phrase: 'Observed influence signal'
  });
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('unlocalized observations must be strength "candidate"')));
});

test('invariant 1: unlocalized observation with non-empty span_ids is invalid', () => {
  const graph = baseGraph();
  graph.observations.push({
    id: 'obs-4',
    dimension: 'language',
    signal: 'bandwagon',
    strength: 'candidate',
    localization: 'unlocalized',
    span_ids: ['span-1'],
    authorial_attribution: 'unknown',
    evidence: { engine: 'jev', question_id: null, top_probability: null, answers_ref: null },
    review_status: 'auto',
    ui_phrase: 'Insufficient context'
  });
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('requires empty span_ids')));
});

test('invariant 2: a quoted-only span set can never be presented as authorial', () => {
  const graph = baseGraph();
  graph.observations[1].authorial_attribution = 'authorial';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('must never be "authorial"')));
});

test('invariant 2: a quoted-only span set must use the quoted UI phrase', () => {
  const graph = baseGraph();
  graph.observations[1].ui_phrase = 'Observed influence signal';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('quoted UI phrase')));
});

test('invariant 3: any claim support other than not_checked requires support_evidence', () => {
  const graph = baseGraph();
  graph.claims[0].support = 'supported';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('requires non-empty support_evidence')));
});

test('invariant 3: unclear support with evidence validates', () => {
  const graph = baseGraph();
  graph.claims[0].support = 'unclear';
  graph.claims[0].support_evidence = [{ url: 'https://example.test/a', source: 'Example wire', published_at: null, note: 'Ambiguous corroboration.' }];
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('invariant 4: fresh status requires provenance and two corroborating timestamp sources', () => {
  const graph = baseGraph();
  graph.coverage.provenance = 'newsjack_artifacts';
  graph.coverage.confidence = 'medium';
  graph.coverage.freshness_gate = {
    computed_status: 'fresh',
    basis_field: 'first_public_at',
    basis_value: '2026-09-17T09:00:00.000Z',
    rationale: 'test'
  };
  graph.coverage.story_origin = {
    same_story_assessment: 'same_story',
    surfaced_article_published_at: '2026-09-17T10:00:00.000Z',
    first_public_at: '2026-09-17T09:00:00.000Z',
    original_url: 'https://example.test/original',
    original_source: 'Example Wire',
    canonical_coverage_url: null,
    canonical_coverage_source: null,
    canonical_coverage_published_at: null,
    canonical_coverage_basis: null,
    same_story_basis: 'headline',
    new_development: false,
    new_development_at: null,
    confidence: 'medium',
    timestamp_evidence: [{ url_key: 'example.test/original', published_at: '2026-09-17T09:00:00.000Z' }],
    evidence_urls: ['https://example.test/original'],
    rationale: 'test'
  };
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('unverified_no_corroboration')));
});

test('invariant 4: fresh status with two distinct corroborating sources validates', () => {
  const graph = baseGraph();
  graph.coverage.provenance = 'newsjack_artifacts';
  graph.coverage.confidence = 'medium';
  graph.coverage.freshness_gate = {
    computed_status: 'fresh',
    basis_field: 'first_public_at',
    basis_value: '2026-09-17T09:00:00.000Z',
    rationale: 'test'
  };
  graph.coverage.story_origin = {
    same_story_assessment: 'same_story',
    surfaced_article_published_at: '2026-09-17T10:00:00.000Z',
    first_public_at: '2026-09-17T09:00:00.000Z',
    original_url: 'https://example.test/original',
    original_source: 'Example Wire',
    canonical_coverage_url: null,
    canonical_coverage_source: null,
    canonical_coverage_published_at: null,
    canonical_coverage_basis: null,
    same_story_basis: 'headline',
    new_development: false,
    new_development_at: null,
    confidence: 'medium',
    timestamp_evidence: [
      { url_key: 'example.test/original', published_at: '2026-09-17T09:00:00.000Z' },
      { url_key: 'other.test/copy', published_at: '2026-09-17T09:10:00.000Z' }
    ],
    evidence_urls: ['https://example.test/original', 'https://other.test/copy'],
    rationale: 'test'
  };
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('invariant 5: no-timestamp artifact requires abstention and low coverage confidence', () => {
  const graph = baseGraph();
  graph.artifact.timestamp_precision = 'none';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('no_timestamp')));
});

test('invariant 5: no-timestamp artifact with abstention and low confidence validates', () => {
  const graph = baseGraph();
  graph.artifact.timestamp_precision = 'none';
  graph.coverage.confidence = 'low';
  graph.abstentions.push({ id: 'abs-1', scope: 'graph', target: null, reason: 'no_timestamp', message: 'Publication time not verified.' });
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('invariant 6: model mismatch requires needs_review on every jev observation', () => {
  const graph = baseGraph();
  graph.engine.jev.model_match = false;
  graph.engine.jev.model_reported = 'jev-1.10.0';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('model_match is false')));
});

test('invariant 6: model mismatch with needs_review on every jev observation validates', () => {
  const graph = baseGraph();
  graph.engine.jev.model_match = false;
  graph.engine.jev.model_reported = 'jev-1.10.0';
  graph.observations[0].review_status = 'needs_review';
  graph.observations[1].review_status = 'needs_review';
  graph.abstentions.push({ id: 'abs-2', scope: 'graph', target: null, reason: 'model_mismatch', message: 'Model version differs; results flagged for review.' });
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('invariant 7: forbidden keys are rejected anywhere in the document', () => {
  const graph = baseGraph();
  graph.artifact.manipulation_score = 42;
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('forbidden key')));
});

test('invariant 7: forbidden phrases are rejected in message and ui_phrase fields', () => {
  const graph = baseGraph();
  graph.abstentions.push({ id: 'abs-3', scope: 'graph', target: null, reason: 'low_confidence', message: 'This proves misinformation.' });
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('forbidden phrase')));
});

test('invariant 8: full_text_persisted and retention must be literal in v1', () => {
  const graph = baseGraph();
  graph.privacy.full_text_persisted = true;
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('full_text_persisted')));
});

test('invariant 9: third_party_ratings must be empty in v1', () => {
  const graph = baseGraph();
  graph.source_context.third_party_ratings = [{ source: 'Example Ratings Co', rating: 'low' }];
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('third_party_ratings')));
});

test('invariant 10: no aggregate numeric score field anywhere in the document', () => {
  const graph = baseGraph();
  graph.overall_score = 73;
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('forbidden key')));
});

test('selective_context_candidate signal is always a candidate, never observed', () => {
  const graph = baseGraph();
  graph.observations[0].signal = 'selective_context_candidate';
  graph.observations[0].strength = 'observed';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('selective_context_candidate must always be strength "candidate"')));
});

test('unknown ui_phrase is rejected', () => {
  const graph = baseGraph();
  graph.observations[0].ui_phrase = 'This source is unsafe';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('not an allowed UI phrase')));
});

test('unknown taxonomy signal is rejected', () => {
  const graph = baseGraph();
  graph.observations[0].signal = 'not_a_real_signal';
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('not a known taxonomy id')));
});

test('claim referencing an unknown span id is rejected', () => {
  const graph = baseGraph();
  graph.claims[0].span_ids = ['nope'];
  const { valid, errors } = validate(graph);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('claims[0].span_ids references unknown span id')));
});

test('clone helper produces an independent copy for mutation-based tests', () => {
  const a = baseGraph();
  const b = clone(a);
  b.graph_id = 'different';
  assert.notEqual(a.graph_id, b.graph_id);
});
