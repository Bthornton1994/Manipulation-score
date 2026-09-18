// Deterministic fusion: typed Jev answers + deterministic rules ->
// observations, claims, coverage, abstentions. See
// docs/media-lens-influence-graph-plan.md sections 4-7. Nothing here calls
// a network or a model; it only combines already-collected inputs.
//
// The wire/advocacy path list is reused from Newsjack
// (https://github.com/elvisun/newsjack) story-origin-check/SKILL.md as a
// constant, MIT License, Copyright (c) 2026 Elvis Sun. See
// docs/NEWSJACK-LICENSE.md.

import { normalizedURLKey } from './url-key.js';
import { randomUUID } from 'node:crypto';

export const THRESHOLDS = Object.freeze({
  observed_min_probability: 0.6,
  candidate_min_probability: 0.45,
  quoted_agreement_min: 0.7,
  failure_rate_abstain: 0.2
});

const WIRE_ADVOCACY_PATH_MARKERS = [
  '/press_release',
  '/press-release',
  '/applauds',
  '/statement',
  'advocacy.',
  'prnewswire',
  'globenewswire',
  'businesswire',
  'accesswire',
  'einpresswire',
  'markets.businessinsider',
  'stocktitan'
];

const PARTNER_REPUBLICATION_HOSTS = ['aol.com', 'yahoo.com', 'msn.com', 'apple.news'];

const ABSOLUTE_QUANTIFIER_PATTERN = /\b(always|never|everyone|no one|guaranteed|undeniably|indisputably)\b/i;
const UNNAMED_SOURCE_PATTERN = /\b(officials say|sources say|experts say|insiders say|people familiar with the matter|a person familiar)\b/i;

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all|any|previous) instructions/i,
  /you are an? (ai|assistant|model)\b/i,
  /mark (this|it|the claim) as (supported|true|verified)/i,
  /system prompt/i
];

const RULE_ENGINE_LOW_CONFIDENCE_UI_PHRASE = 'Observed influence signal';
const QUOTED_UI_PHRASE = 'Quoted language not attributed as authorial';
const SELECTIVE_CONTEXT_UI_PHRASE = 'Possible selective-context candidate';

function isWireOrAdvocacyUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return WIRE_ADVOCACY_PATH_MARKERS.some((marker) => lower.includes(marker));
}

function isPartnerRepublicationHost(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PARTNER_REPUBLICATION_HOSTS.some((partner) => host === partner || host.endsWith(`.${partner}`));
  } catch {
    return false;
  }
}

function quotedOnlyRole(role) {
  return role === 'quoted' || role === 'attributed_paraphrase';
}

function detectPromptInjection(spanText) {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(spanText));
}

/**
 * Resolve final span roles: apply the engine-disagreement override when a
 * deterministically "authorial" span is flagged by Jev's
 * is_quoted_or_attributed noul above the agreement threshold. Jev is never
 * the authority for authorship, so this only ever moves a span to
 * "uncertain", never to "quoted".
 */
function resolveSpans(spans, jevAnswersBySpanId) {
  const engineDisagreementSpanIds = new Set();
  const resolved = spans.map((span) => {
    if (span.role !== 'authorial') return { ...span };
    const answers = jevAnswersBySpanId.get(span.id);
    const noul = answers?.is_quoted_or_attributed?.noul;
    if (typeof noul === 'number' && noul >= THRESHOLDS.quoted_agreement_min) {
      engineDisagreementSpanIds.add(span.id);
      return { ...span, role: 'uncertain', role_basis: 'engine_disagreement' };
    }
    return { ...span };
  });
  return { resolvedSpans: resolved, engineDisagreementSpanIds };
}

function authorialAttributionForRole(role) {
  if (role === 'uncertain') return 'unknown';
  if (quotedOnlyRole(role)) return 'quoted';
  return 'authorial';
}

function buildJevLanguageObservations({ resolvedSpans, jevAnswersBySpanId, engineDisagreementSpanIds, injectedSpanIds }) {
  const observations = [];
  let counter = 0;
  const spanById = new Map(resolvedSpans.map((s) => [s.id, s]));

  for (const span of resolvedSpans) {
    if (span.role === 'boilerplate' || span.role === 'byline_meta') continue;
    const answers = jevAnswersBySpanId.get(span.id);
    if (!answers) continue;

    const choice = answers.influence_signal?.choice;
    if (!choice || choice === 'none') continue;

    const probabilities = answers.influence_signal?.probabilities || {};
    const topProbability = typeof probabilities[choice] === 'number' ? probabilities[choice] : answers.influence_signal?.confidence ?? null;

    let strength = null;
    if (typeof topProbability === 'number') {
      if (topProbability >= THRESHOLDS.observed_min_probability) strength = 'observed';
      else if (topProbability >= THRESHOLDS.candidate_min_probability) strength = 'candidate';
    }
    if (!strength) continue;

    // Taxonomy rule: certainty_beyond_evidence / vague_authority need a
    // deterministic marker in the span text to ever reach "observed".
    if (['certainty_beyond_evidence', 'vague_authority'].includes(choice) && strength === 'observed') {
      const hasMarker =
        (choice === 'certainty_beyond_evidence' && ABSOLUTE_QUANTIFIER_PATTERN.test(span.text)) ||
        (choice === 'vague_authority' && UNNAMED_SOURCE_PATTERN.test(span.text));
      if (!hasMarker) strength = 'candidate';
    }

    const isEngineDisagreement = engineDisagreementSpanIds.has(span.id);
    const isInjected = injectedSpanIds.has(span.id);
    if (isInjected) strength = 'candidate';

    const authorialAttribution = authorialAttributionForRole(span.role);
    const quotedOnly = quotedOnlyRole(span.role);

    let reviewStatus = 'auto';
    if (isEngineDisagreement || isInjected) reviewStatus = 'needs_review';

    let uiPhrase = RULE_ENGINE_LOW_CONFIDENCE_UI_PHRASE;
    if (quotedOnly) uiPhrase = QUOTED_UI_PHRASE;

    counter += 1;
    observations.push({
      id: `obs-jev-${counter}`,
      dimension: 'language',
      signal: choice,
      strength,
      localization: 'span',
      span_ids: [span.id],
      authorial_attribution: authorialAttribution,
      evidence: { engine: 'jev', question_id: 'influence_signal', top_probability: topProbability, answers_ref: span.id },
      review_status: reviewStatus,
      ui_phrase: uiPhrase
    });
  }

  return observations;
}

/**
 * Deterministic-only candidates that do not require Jev at all: absolute
 * quantifiers in authorial spans, and quoted spans with no attribution
 * cue/speaker (a possible selective-context candidate). These still appear
 * when the Jev engine is disabled or unavailable.
 */
function buildDeterministicObservations({ resolvedSpans, injectedSpanIds }) {
  const observations = [];
  let counter = 0;

  for (const span of resolvedSpans) {
    if (span.role === 'boilerplate' || span.role === 'byline_meta') continue;

    if ((span.role === 'authorial' || span.role === 'uncertain') && ABSOLUTE_QUANTIFIER_PATTERN.test(span.text)) {
      counter += 1;
      observations.push({
        id: `obs-rule-${counter}`,
        dimension: 'language',
        signal: 'certainty_beyond_evidence',
        strength: 'candidate',
        localization: 'span',
        span_ids: [span.id],
        authorial_attribution: authorialAttributionForRole(span.role),
        evidence: { engine: 'rule', question_id: null, top_probability: null, answers_ref: null },
        review_status: injectedSpanIds.has(span.id) ? 'needs_review' : 'auto',
        ui_phrase: RULE_ENGINE_LOW_CONFIDENCE_UI_PHRASE
      });
    }

    if (quotedOnlyRole(span.role) && !span.attribution?.speaker && !span.attribution?.cue) {
      counter += 1;
      observations.push({
        id: `obs-rule-${counter}`,
        dimension: 'coverage',
        signal: 'selective_context_candidate',
        strength: 'candidate',
        localization: 'span',
        span_ids: [span.id],
        authorial_attribution: 'quoted',
        evidence: { engine: 'rule', question_id: null, top_probability: null, answers_ref: null },
        review_status: injectedSpanIds.has(span.id) ? 'needs_review' : 'auto',
        ui_phrase: QUOTED_UI_PHRASE
      });
    }
  }

  return observations;
}

function buildClaims({ claimCandidates, resolvedSpans, injectedSpanIds }) {
  const spanById = new Map(resolvedSpans.map((s) => [s.id, s]));
  return claimCandidates.map((candidate, i) => {
    const span = spanById.get(candidate.spanId);
    const attribution = span ? authorialAttributionForRole(span.role) : candidate.attribution || 'unknown';
    return {
      id: `claim-${i + 1}`,
      span_ids: [candidate.spanId],
      text: candidate.text,
      kind: candidate.kind,
      attribution,
      support: 'not_checked',
      support_evidence: [],
      review_status: injectedSpanIds.has(candidate.spanId) ? 'needs_review' : 'auto'
    };
  });
}

function computeClusterCoverage(cluster) {
  if (!cluster || !Array.isArray(cluster.members)) return null;
  const memberCount = cluster.members.length;
  const keptMembers = cluster.members.filter((member) => {
    if (member.relation === 'syndicated') return false;
    if (isWireOrAdvocacyUrl(member.url)) return false;
    if (isPartnerRepublicationHost(member.url) && cluster.members.some((m) => m.relation === 'surfaced' || m.relation === 'same_story')) {
      return false;
    }
    return true;
  });
  const distinctKeys = new Set(keptMembers.map((m) => m.url_key || normalizedURLKey(m.url)).filter(Boolean));
  const independentSourcesEstimate = distinctKeys.size;
  return {
    member_count: memberCount,
    independent_sources_estimate: independentSourcesEstimate,
    duplicate_or_syndicated_count: memberCount - independentSourcesEstimate,
    members: cluster.members
  };
}

function resolveFreshnessGate({ freshnessGate, storyOrigin, provenance }) {
  if (!freshnessGate) return null;
  const isFreshClaim = ['fresh', 'fresh_new_development'].includes(freshnessGate.computed_status);
  if (!isFreshClaim) return { ...freshnessGate };

  const timestampEvidence = storyOrigin?.timestamp_evidence || [];
  const distinctUrlKeys = new Set(timestampEvidence.map((e) => e?.url_key).filter(Boolean));
  const corroborated = provenance !== 'none' && timestampEvidence.length >= 2 && distinctUrlKeys.size >= 2;

  if (corroborated) return { ...freshnessGate };

  return {
    ...freshnessGate,
    computed_status: 'unverified_no_corroboration',
    rationale: 'Origin not yet corroborated: fewer than two independent sources provide timestamp evidence for this story.'
  };
}

function buildCoverage({ newsjackResult, artifactHasUrl }) {
  const provenance = newsjackResult?.provenance || 'none';
  if (!artifactHasUrl && provenance === 'none') {
    return {
      status: 'not_requested',
      provenance: 'none',
      story_origin: null,
      freshness_gate: null,
      cluster: null,
      frames: [],
      confidence: 'low'
    };
  }

  const cluster = computeClusterCoverage(newsjackResult?.cluster);
  const freshnessGate = resolveFreshnessGate({
    freshnessGate: newsjackResult?.freshness_gate,
    storyOrigin: newsjackResult?.story_origin,
    provenance
  });

  const status = provenance === 'none' ? 'insufficient' : 'available';
  let confidence = newsjackResult?.story_origin?.confidence || (status === 'available' ? 'medium' : 'low');
  if (!['high', 'medium', 'low'].includes(confidence)) confidence = 'low';

  return {
    status,
    provenance,
    story_origin: newsjackResult?.story_origin || null,
    freshness_gate: freshnessGate,
    cluster,
    frames: [],
    confidence
  };
}

/**
 * Run the full deterministic fusion step.
 *
 * @param {object} input
 * @param {object[]} input.spans - spans from prepare.js
 * @param {object[]} input.claimCandidates - claim candidates from prepare.js
 * @param {boolean} input.artifactHasUrl
 * @param {Map<string, object>} input.jevAnswersBySpanId
 * @param {Set<string>} input.jevFailedSpanIds
 * @param {number} input.jevCalls
 * @param {string} input.jevMode
 * @param {boolean|null} input.jevModelMatch
 * @param {object|null} input.newsjackResult
 */
export function fuse({
  spans,
  claimCandidates,
  artifactHasUrl,
  jevAnswersBySpanId,
  jevFailedSpanIds,
  jevCalls,
  jevMode,
  jevModelMatch,
  newsjackResult
}) {
  const injectedSpanIds = new Set(spans.filter((s) => detectPromptInjection(s.text)).map((s) => s.id));
  const { resolvedSpans, engineDisagreementSpanIds } = resolveSpans(spans, jevAnswersBySpanId);

  const abstentions = [];

  for (const spanId of injectedSpanIds) {
    abstentions.push({
      id: `abst-injection-${spanId}`,
      scope: 'span',
      target: spanId,
      reason: 'prompt_injection_suspected',
      message: 'This section contains wording that resembles an instruction to an AI system. It is treated as ordinary article text and flagged for human review.'
    });
  }

  for (const spanId of jevFailedSpanIds) {
    abstentions.push({
      id: `abst-failure-${spanId}`,
      scope: 'span',
      target: spanId,
      reason: 'engine_failure',
      message: 'The typed classifier did not return a usable answer for this section, so no signal is shown for it.'
    });
  }

  let jevObservations = buildJevLanguageObservations({ resolvedSpans, jevAnswersBySpanId, engineDisagreementSpanIds, injectedSpanIds });
  const deterministicObservations = buildDeterministicObservations({ resolvedSpans, injectedSpanIds });

  const failureRate = jevCalls > 0 ? jevFailedSpanIds.size / jevCalls : 0;
  let languageUnreviewed = false;
  if (jevMode !== 'disabled' && failureRate > THRESHOLDS.failure_rate_abstain) {
    languageUnreviewed = true;
    jevObservations = [];
    abstentions.push({
      id: 'abst-language-unreviewed',
      scope: 'dimension',
      target: 'language',
      reason: 'engine_failure',
      message: 'The typed classifier failed on too many sections of this article, so the Language dimension is unreviewed rather than shown with partial results.'
    });
  }

  if (jevMode === 'disabled') {
    abstentions.push({
      id: 'abst-language-disabled',
      scope: 'dimension',
      target: 'language',
      reason: 'engine_disabled',
      message: 'The typed classifier is disabled for this analysis. Only deterministic candidate signals are shown.'
    });
  }

  if (jevModelMatch === false) {
    for (const obs of jevObservations) obs.review_status = 'needs_review';
    abstentions.push({
      id: 'abst-model-mismatch',
      scope: 'dimension',
      target: 'language',
      reason: 'model_mismatch',
      message: 'The typed classifier reported a different model version than requested. Language results are flagged for review.'
    });
  }

  const observations = [...jevObservations, ...deterministicObservations];
  const claims = buildClaims({ claimCandidates, resolvedSpans, injectedSpanIds });
  const coverage = buildCoverage({ newsjackResult, artifactHasUrl });

  if (coverage.status !== 'available') {
    abstentions.push({
      id: 'abst-coverage-provenance',
      scope: 'dimension',
      target: 'coverage',
      reason: 'no_provenance',
      message: 'No independent provenance data is available for this article, so coverage information is limited.'
    });
  }

  return {
    resolvedSpans,
    observations,
    claims,
    coverage,
    abstentions,
    languageUnreviewed,
    injectedSpanIds
  };
}

export { detectPromptInjection, isWireOrAdvocacyUrl, isPartnerRepublicationHost, WIRE_ADVOCACY_PATH_MARKERS, PARTNER_REPUBLICATION_HOSTS };
export const UI_PHRASES = { QUOTED_UI_PHRASE, SELECTIVE_CONTEXT_UI_PHRASE, RULE_ENGINE_LOW_CONFIDENCE_UI_PHRASE };
