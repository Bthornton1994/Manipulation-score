import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { validate } from '../media-lens/schema/validate.js';

test('fixture 02: duplicates are not independent (5 members, 2 syndicated + 1 wire)', async () => {
  const graph = await runFixture('synthetic-02-syndicated-cluster');
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(graph.coverage.cluster.member_count, 5);
  assert.equal(graph.coverage.cluster.independent_sources_estimate, 2);
  assert.equal(graph.coverage.cluster.duplicate_or_syndicated_count, 3);
  assert.equal(graph.coverage.freshness_gate.computed_status, 'fresh');
});

test('a fresh claim with only one corroborating timestamp source is downgraded to unverified_no_corroboration', async () => {
  const { fuse } = await import('../media-lens/worker/fusion.js');
  const result = fuse({
    spans: [],
    claimCandidates: [],
    artifactHasUrl: true,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: 0,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: {
      provenance: 'fixture',
      story_origin: {
        confidence: 'medium',
        timestamp_evidence: [{ url_key: 'https://example.test/a', published_at: '2026-09-17T09:00:00.000Z' }]
      },
      freshness_gate: { computed_status: 'fresh', basis_field: 'first_public_at', basis_value: '2026-09-17T09:00:00.000Z', rationale: 'test' },
      cluster: null
    }
  });
  assert.equal(result.coverage.freshness_gate.computed_status, 'unverified_no_corroboration');
  assert.match(result.coverage.freshness_gate.rationale, /Origin not yet corroborated/);
});

test('provenance "none" never yields a fresh status', async () => {
  const { fuse } = await import('../media-lens/worker/fusion.js');
  const result = fuse({
    spans: [],
    claimCandidates: [],
    artifactHasUrl: true,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: 0,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: {
      provenance: 'none',
      story_origin: {
        timestamp_evidence: [
          { url_key: 'https://example.test/a', published_at: '2026-09-17T09:00:00.000Z' },
          { url_key: 'https://example.test/b', published_at: '2026-09-17T09:05:00.000Z' }
        ]
      },
      freshness_gate: { computed_status: 'fresh', basis_field: 'first_public_at', basis_value: '2026-09-17T09:00:00.000Z', rationale: 'test' },
      cluster: null
    }
  });
  assert.equal(result.coverage.freshness_gate.computed_status, 'unverified_no_corroboration');
});

test('fixture 03: missing timestamp forces low coverage confidence and a no_timestamp abstention with the expected UI text', async () => {
  const graph = await runFixture('synthetic-03-no-timestamp');
  assert.equal(graph.artifact.timestamp_precision, 'none');
  assert.equal(graph.coverage.confidence, 'low');
  const abstention = graph.abstentions.find((a) => a.reason === 'no_timestamp');
  assert.ok(abstention);
  assert.match(abstention.message, /Publication time not verified/);

  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});
