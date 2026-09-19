import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { fuse, THRESHOLDS } from '../media-lens/worker/fusion.js';

test('fixture 01: quoted span gets authorial_attribution quoted and the quoted UI phrase', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  const quotedSpan = graph.spans.find((s) => s.role === 'quoted');
  assert.ok(quotedSpan, 'expected a quoted span');
  assert.equal(quotedSpan.attribution.speaker, 'the mayor');
  assert.equal(quotedSpan.attribution.cue, 'said');

  const obsOnQuoted = graph.observations.find((o) => o.span_ids.includes(quotedSpan.id));
  assert.ok(obsOnQuoted, 'expected an observation on the quoted span');
  assert.equal(obsOnQuoted.authorial_attribution, 'quoted');
  assert.equal(obsOnQuoted.ui_phrase, 'Quoted language not attributed as authorial');
});

test('fixture 01: the same content stated outside quotes is authorial, not quoted', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  const authorialEquivalent = graph.spans.find((s) => s.text.includes('The council said it would fix the flooding problem'));
  assert.ok(authorialEquivalent);
  assert.equal(authorialEquivalent.role, 'authorial');
  const obs = graph.observations.find((o) => o.span_ids.includes(authorialEquivalent.id));
  assert.ok(obs);
  assert.equal(obs.authorial_attribution, 'authorial');
  assert.notEqual(obs.ui_phrase, 'Quoted language not attributed as authorial');
});

test('fixture 01: engine disagreement moves an authorial span to uncertain and needs_review', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  const disagreementSpan = graph.spans.find((s) => s.role_basis === 'engine_disagreement');
  assert.ok(disagreementSpan, 'expected an engine-disagreement span');
  assert.equal(disagreementSpan.role, 'uncertain');

  const obs = graph.observations.find((o) => o.span_ids.includes(disagreementSpan.id));
  assert.ok(obs);
  assert.equal(obs.authorial_attribution, 'unknown');
  assert.equal(obs.review_status, 'needs_review');
});

test('unlocalized observation from fuse() is a candidate with empty span_ids (invariant 1)', () => {
  const result = fuse({
    spans: [],
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: 0,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  assert.deepEqual(result.observations, []);
  assert.equal(result.coverage.status, 'not_requested');
});

test('certainty_beyond_evidence without an absolute quantifier never reaches "observed"', () => {
  const spans = [
    { id: 'span-1', start: 0, end: 10, text: 'The council said it would act on this matter soon.', paragraph_index: 0, role: 'authorial', attribution: { speaker: null, cue: null }, role_basis: 'default' }
  ];
  const jevAnswersBySpanId = new Map([
    ['span-1', { influence_signal: { choice: 'certainty_beyond_evidence', probabilities: { certainty_beyond_evidence: 0.95 } }, is_quoted_or_attributed: { noul: 0.1 }, is_checkable_claim: { noul: 0.1 } }]
  ]);
  const result = fuse({
    spans,
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId,
    jevFailedSpanIds: new Set(),
    jevCalls: 1,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  const obs = result.observations.find((o) => o.signal === 'certainty_beyond_evidence');
  assert.ok(obs);
  assert.equal(obs.strength, 'candidate');
});

test('certainty_beyond_evidence with an absolute quantifier can reach "observed"', () => {
  const spans = [
    { id: 'span-1', start: 0, end: 10, text: 'This policy always fails and never once has it worked.', paragraph_index: 0, role: 'authorial', attribution: { speaker: null, cue: null }, role_basis: 'default' }
  ];
  const jevAnswersBySpanId = new Map([
    ['span-1', { influence_signal: { choice: 'certainty_beyond_evidence', probabilities: { certainty_beyond_evidence: 0.95 } }, is_quoted_or_attributed: { noul: 0.1 }, is_checkable_claim: { noul: 0.1 } }]
  ]);
  const result = fuse({
    spans,
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId,
    jevFailedSpanIds: new Set(),
    jevCalls: 1,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  const obs = result.observations.find((o) => o.signal === 'certainty_beyond_evidence');
  assert.ok(obs);
  assert.equal(obs.strength, 'observed');
});

test('a quoted span with no attribution speaker or cue becomes a selective_context_candidate', () => {
  const spans = [
    { id: 'span-1', start: 0, end: 10, text: 'Something happened.', paragraph_index: 0, role: 'quoted', attribution: { speaker: null, cue: null }, role_basis: 'quote_marks' }
  ];
  const result = fuse({
    spans,
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: 0,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  const obs = result.observations.find((o) => o.signal === 'selective_context_candidate');
  assert.ok(obs, 'expected a selective_context_candidate observation');
  assert.equal(obs.strength, 'candidate');
  assert.equal(obs.dimension, 'coverage');
  assert.equal(obs.ui_phrase, 'Quoted language not attributed as authorial');
});

test('failure rate above the threshold marks the Language dimension unreviewed', () => {
  const spans = Array.from({ length: 5 }, (_, i) => ({
    id: `span-${i + 1}`,
    start: i,
    end: i + 1,
    text: `Sentence number ${i + 1}.`,
    paragraph_index: i,
    role: 'authorial',
    attribution: { speaker: null, cue: null },
    role_basis: 'default'
  }));
  // Only span-1 has an answer; 4/5 = 80% failure, well above failure_rate_abstain (0.2).
  const jevAnswersBySpanId = new Map([
    ['span-1', { influence_signal: { choice: 'urgency', probabilities: { urgency: 0.9 } }, is_quoted_or_attributed: { noul: 0.1 }, is_checkable_claim: { noul: 0.1 } }]
  ]);
  const jevFailedSpanIds = new Set(['span-2', 'span-3', 'span-4', 'span-5']);
  const result = fuse({
    spans,
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId,
    jevFailedSpanIds,
    jevCalls: 5,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  assert.equal(result.languageUnreviewed, true);
  assert.equal(result.observations.filter((o) => o.evidence.engine === 'jev').length, 0);
  assert.ok(result.abstentions.some((a) => a.scope === 'dimension' && a.target === 'language'));
});

test('L4: artifact.publisher.name is null when the source article has no og:site_name (never falls back to the domain)', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  assert.equal(graph.artifact.publisher.name, null);
  assert.equal(graph.artifact.publisher.domain, 'fictional-daily.example');
  assert.equal(graph.source_context.publisher.name, null);
});

test('duplicate/syndicated cluster members are not counted as independent sources', async () => {
  const graph = await runFixture('synthetic-02-syndicated-cluster');
  assert.equal(graph.coverage.cluster.member_count, 5);
  assert.equal(graph.coverage.cluster.independent_sources_estimate, 2);
  assert.equal(graph.coverage.cluster.duplicate_or_syndicated_count, 3);
});

test('H1: fusion never produces an observation for an out-of-taxonomy jev answer, even if fed one directly', () => {
  const spans = [
    { id: 'span-1', start: 0, end: 10, text: 'Officials said the plan would proceed as scheduled.', paragraph_index: 0, role: 'authorial', attribution: { speaker: null, cue: null }, role_basis: 'default' }
  ];
  // Simulate what a buggy or future adapter could pass through, bypassing
  // adapters/jev.js#isPlausibleAnswers entirely: fusion must not trust it.
  const jevAnswersBySpanId = new Map([
    ['span-1', { influence_signal: { choice: 'outlet_is_untrustworthy_propaganda', probabilities: { outlet_is_untrustworthy_propaganda: 0.99 } }, is_quoted_or_attributed: { noul: 0.1 } }]
  ]);
  const result = fuse({
    spans,
    claimCandidates: [],
    artifactHasUrl: false,
    jevAnswersBySpanId,
    jevFailedSpanIds: new Set(),
    jevCalls: 1,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: null
  });
  assert.deepEqual(result.observations, []);
});

test('fusion thresholds match the schema documented constants', () => {
  assert.deepEqual(THRESHOLDS, {
    observed_min_probability: 0.6,
    candidate_min_probability: 0.45,
    quoted_agreement_min: 0.7,
    failure_rate_abstain: 0.2
  });
});
