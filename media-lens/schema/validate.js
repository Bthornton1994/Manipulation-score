#!/usr/bin/env node
// Hand-written validator for influence-graph.v1. No dependencies.
//
// Usage as a library:
//   import { validate } from './validate.js';
//   const { valid, errors } = validate(graph);
//
// Usage as a CLI (reads a graph JSON document from stdin):
//   node media-lens/worker/analyze-fixture.js <fixture-id> | node media-lens/schema/validate.js
//
// This file enforces the structural shape described in
// docs/media-lens-influence-graph-plan.md section 3, plus the ten
// cross-field invariants listed at the end of that section. The
// media-lens/schema/influence-graph.v1.json file documents the same shape
// for humans; this validator is the one the worker and tests actually run.

import { TAXONOMY_IDS, ALLOWED_UI_PHRASES, BANNED_PHRASES } from './taxonomy.js';

const FORBIDDEN_KEY_PATTERN = /score|rank|leaderboard|manipulat|trust|credib|reliab/i;

const ARTIFACT_KINDS = ['article', 'headline', 'excerpt', 'speech', 'ad', 'campaign', 'other_public'];
const INPUT_MODES = ['url', 'pasted_text', 'fixture'];
const TIMESTAMP_PRECISIONS = ['time', 'date', 'none'];
const LANGUAGES = ['en', 'und'];
const SPAN_ROLES = [
  'headline',
  'subhead',
  'authorial',
  'quoted',
  'attributed_paraphrase',
  'caption',
  'byline_meta',
  'boilerplate',
  'uncertain'
];
const ROLE_BASES = ['quote_marks', 'blockquote', 'attribution_cue', 'html_structure', 'default', 'engine_disagreement'];
const OBSERVATION_DIMENSIONS = ['language', 'coverage'];
const STRENGTHS = ['observed', 'candidate'];
const LOCALIZATIONS = ['span', 'unlocalized'];
const ATTRIBUTIONS = ['authorial', 'quoted', 'mixed', 'unknown'];
const REVIEW_STATUSES = ['auto', 'needs_review', 'unreviewed'];
const CLAIM_KINDS = ['statistic', 'event', 'attribution', 'prediction', 'evaluation', 'other'];
const SUPPORTS = ['supported', 'contradicted', 'mixed', 'unclear', 'not_checked'];
const COVERAGE_STATUSES = ['available', 'insufficient', 'not_requested'];
const PROVENANCES = ['fixture', 'newsjack_artifacts', 'newsjack_cli', 'none'];
const FRESHNESS_STATUSES = [
  'fresh',
  'fresh_new_development',
  'stale',
  'unverified_boundary',
  'unverified_no_timestamp',
  'unverified_no_corroboration'
];
const CONFIDENCES = ['high', 'medium', 'low'];
const ABSTENTION_SCOPES = ['graph', 'dimension', 'span', 'claim'];
const ABSTENTION_REASONS = [
  'insufficient_text',
  'paywall',
  'unsupported_language',
  'oversized_input',
  'engine_disabled',
  'engine_unavailable',
  'engine_failure',
  'model_mismatch',
  'low_confidence',
  'no_timestamp',
  'no_provenance',
  'prompt_injection_suspected'
];
const JEV_MODES = ['fixture', 'live', 'disabled'];
const NEWSJACK_MODES = ['fixture', 'artifacts', 'cli', 'disabled'];
const SPANS_INCLUDED = ['all', 'evidence_only'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function req(errors, condition, message) {
  if (!condition) errors.push(message);
}

function inEnum(value, list) {
  return list.includes(value);
}

function walkForbiddenKeys(node, path, errors) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkForbiddenKeys(item, `${path}[${i}]`, errors));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      errors.push(`forbidden key "${key}" at ${path}.${key} (matches /score|rank|leaderboard|manipulat|trust|credib|reliab/i)`);
    }
    if ((key === 'message' || key === 'ui_phrase' || key === 'note' || key === 'rationale') && typeof value === 'string') {
      for (const banned of BANNED_PHRASES) {
        if (value.toLowerCase().includes(banned)) {
          errors.push(`forbidden phrase "${banned}" found in ${path}.${key}`);
        }
      }
    }
    walkForbiddenKeys(value, `${path}.${key}`, errors);
  }
}

function validateArtifact(artifact, errors) {
  const p = 'artifact';
  if (!isPlainObject(artifact)) {
    errors.push(`${p} must be an object`);
    return;
  }
  req(errors, inEnum(artifact.kind, ARTIFACT_KINDS), `${p}.kind must be one of ${ARTIFACT_KINDS.join(', ')}`);
  req(errors, inEnum(artifact.input_mode, INPUT_MODES), `${p}.input_mode must be one of ${INPUT_MODES.join(', ')}`);
  req(errors, artifact.url === null || typeof artifact.url === 'string', `${p}.url must be string or null`);
  req(errors, artifact.canonical_url === null || typeof artifact.canonical_url === 'string', `${p}.canonical_url must be string or null`);
  req(errors, artifact.title === null || typeof artifact.title === 'string', `${p}.title must be string or null`);
  req(errors, artifact.byline === null || typeof artifact.byline === 'string', `${p}.byline must be string or null`);
  req(errors, isPlainObject(artifact.publisher), `${p}.publisher must be an object`);
  if (isPlainObject(artifact.publisher)) {
    req(
      errors,
      artifact.publisher.name === null || typeof artifact.publisher.name === 'string',
      `${p}.publisher.name must be string or null`
    );
    req(
      errors,
      artifact.publisher.domain === null || typeof artifact.publisher.domain === 'string',
      `${p}.publisher.domain must be string or null`
    );
  }
  req(errors, inEnum(artifact.timestamp_precision, TIMESTAMP_PRECISIONS), `${p}.timestamp_precision invalid`);
  req(errors, inEnum(artifact.language, LANGUAGES), `${p}.language must be one of ${LANGUAGES.join(', ')}`);
  req(errors, typeof artifact.text_sha256 === 'string' && artifact.text_sha256.length > 0, `${p}.text_sha256 required`);
  req(errors, Number.isInteger(artifact.text_length_chars), `${p}.text_length_chars must be an integer`);
  req(errors, typeof artifact.paywall_detected === 'boolean', `${p}.paywall_detected must be boolean`);
  req(errors, isPlainObject(artifact.authorization), `${p}.authorization must be an object`);
  if (isPlainObject(artifact.authorization)) {
    req(
      errors,
      typeof artifact.authorization.user_asserted_public === 'boolean',
      `${p}.authorization.user_asserted_public must be boolean`
    );
    req(
      errors,
      artifact.authorization.consent_at === null || typeof artifact.authorization.consent_at === 'string',
      `${p}.authorization.consent_at must be string or null`
    );
  }
}

function validateSpans(spans, errors) {
  if (!Array.isArray(spans)) {
    errors.push('spans must be an array');
    return new Set();
  }
  const ids = new Set();
  spans.forEach((span, i) => {
    const p = `spans[${i}]`;
    req(errors, typeof span.id === 'string' && span.id.length > 0, `${p}.id required`);
    if (typeof span.id === 'string') {
      if (ids.has(span.id)) errors.push(`${p}.id "${span.id}" is duplicated`);
      ids.add(span.id);
    }
    req(errors, Number.isInteger(span.start) && span.start >= 0, `${p}.start must be a non-negative integer`);
    req(errors, Number.isInteger(span.end) && span.end >= span.start, `${p}.end must be an integer >= start`);
    req(errors, typeof span.text === 'string', `${p}.text must be a string`);
    req(errors, Number.isInteger(span.paragraph_index), `${p}.paragraph_index must be an integer`);
    req(errors, inEnum(span.role, SPAN_ROLES), `${p}.role must be one of ${SPAN_ROLES.join(', ')}`);
    req(errors, inEnum(span.role_basis, ROLE_BASES), `${p}.role_basis must be one of ${ROLE_BASES.join(', ')}`);
    req(errors, isPlainObject(span.attribution), `${p}.attribution must be an object`);
  });
  return ids;
}

function isQuotedOnlyRole(role) {
  return role === 'quoted' || role === 'attributed_paraphrase';
}

function validateObservations(observations, spanIds, spanById, errors) {
  if (!Array.isArray(observations)) {
    errors.push('observations must be an array');
    return;
  }
  observations.forEach((obs, i) => {
    const p = `observations[${i}]`;
    req(errors, inEnum(obs.dimension, OBSERVATION_DIMENSIONS), `${p}.dimension must be one of ${OBSERVATION_DIMENSIONS.join(', ')}`);
    req(errors, TAXONOMY_IDS.includes(obs.signal), `${p}.signal "${obs.signal}" is not a known taxonomy id`);
    req(errors, inEnum(obs.strength, STRENGTHS), `${p}.strength must be one of ${STRENGTHS.join(', ')}`);
    req(errors, inEnum(obs.localization, LOCALIZATIONS), `${p}.localization must be one of ${LOCALIZATIONS.join(', ')}`);
    req(errors, Array.isArray(obs.span_ids), `${p}.span_ids must be an array`);
    req(errors, inEnum(obs.authorial_attribution, ATTRIBUTIONS), `${p}.authorial_attribution invalid`);
    req(errors, inEnum(obs.review_status, REVIEW_STATUSES), `${p}.review_status invalid`);
    req(errors, ALLOWED_UI_PHRASES.includes(obs.ui_phrase), `${p}.ui_phrase "${obs.ui_phrase}" is not an allowed UI phrase`);
    if (isPlainObject(obs.evidence)) {
      const topProbability = obs.evidence.top_probability;
      req(
        errors,
        topProbability === null || (typeof topProbability === 'number' && Number.isFinite(topProbability) && topProbability >= 0 && topProbability <= 1),
        `${p}.evidence.top_probability must be null or a number in [0, 1]`
      );
    }

    // Invariant 1: span-localized observations reference existing spans and
    // are non-empty; unlocalized observations have empty span_ids and must
    // be a candidate, never an "observed" location-free claim.
    if (obs.localization === 'span') {
      req(errors, Array.isArray(obs.span_ids) && obs.span_ids.length > 0, `${p}: localization "span" requires non-empty span_ids`);
      if (Array.isArray(obs.span_ids)) {
        for (const id of obs.span_ids) {
          req(errors, spanIds.has(id), `${p}.span_ids references unknown span id "${id}"`);
        }
      }
    } else if (obs.localization === 'unlocalized') {
      req(errors, Array.isArray(obs.span_ids) && obs.span_ids.length === 0, `${p}: localization "unlocalized" requires empty span_ids`);
      req(errors, obs.strength === 'candidate', `${p}: unlocalized observations must be strength "candidate"`);
    }

    // Invariant 2: an observation whose referenced spans are all quoted or
    // attributed_paraphrase is never presented as the author's own words.
    if (obs.localization === 'span' && Array.isArray(obs.span_ids) && obs.span_ids.length > 0) {
      const roles = obs.span_ids.map((id) => spanById.get(id)?.role).filter(Boolean);
      const allQuoted = roles.length > 0 && roles.every(isQuotedOnlyRole);
      if (allQuoted) {
        req(errors, obs.authorial_attribution === 'quoted', `${p}: quoted-only span set must have authorial_attribution "quoted"`);
        req(
          errors,
          obs.ui_phrase === 'Quoted language not attributed as authorial',
          `${p}: quoted-only span set must use the quoted UI phrase`
        );
      }
      req(errors, obs.authorial_attribution !== 'authorial' || !allQuoted, `${p}: quoted-only span set must never be "authorial"`);
    }

    // Taxonomy rule: selective_context_candidate is only ever a candidate.
    if (obs.signal === 'selective_context_candidate') {
      req(errors, obs.strength === 'candidate', `${p}: selective_context_candidate must always be strength "candidate"`);
    }
  });
}

function validateClaims(claims, spanIds, errors) {
  if (!Array.isArray(claims)) {
    errors.push('claims must be an array');
    return;
  }
  claims.forEach((claim, i) => {
    const p = `claims[${i}]`;
    req(errors, Array.isArray(claim.span_ids) && claim.span_ids.length > 0, `${p}.span_ids must be non-empty`);
    if (Array.isArray(claim.span_ids)) {
      for (const id of claim.span_ids) {
        req(errors, spanIds.has(id), `${p}.span_ids references unknown span id "${id}"`);
      }
    }
    req(errors, typeof claim.text === 'string' && claim.text.length > 0, `${p}.text required`);
    req(errors, inEnum(claim.kind, CLAIM_KINDS), `${p}.kind must be one of ${CLAIM_KINDS.join(', ')}`);
    req(errors, inEnum(claim.attribution, ATTRIBUTIONS), `${p}.attribution invalid`);
    req(errors, inEnum(claim.support, SUPPORTS), `${p}.support must be one of ${SUPPORTS.join(', ')}`);
    req(errors, Array.isArray(claim.support_evidence), `${p}.support_evidence must be an array`);
    req(errors, inEnum(claim.review_status, REVIEW_STATUSES), `${p}.review_status invalid`);

    // Invariant 3
    if (claim.support && claim.support !== 'not_checked') {
      req(
        errors,
        Array.isArray(claim.support_evidence) && claim.support_evidence.length > 0,
        `${p}: support "${claim.support}" requires non-empty support_evidence`
      );
    }
  });
}

function validateCoverage(coverage, errors) {
  const p = 'coverage';
  if (!isPlainObject(coverage)) {
    errors.push(`${p} must be an object`);
    return;
  }
  req(errors, inEnum(coverage.status, COVERAGE_STATUSES), `${p}.status invalid`);
  req(errors, inEnum(coverage.provenance, PROVENANCES), `${p}.provenance invalid`);
  req(errors, coverage.story_origin === null || isPlainObject(coverage.story_origin), `${p}.story_origin must be object or null`);
  req(errors, coverage.freshness_gate === null || isPlainObject(coverage.freshness_gate), `${p}.freshness_gate must be object or null`);
  req(errors, coverage.cluster === null || isPlainObject(coverage.cluster), `${p}.cluster must be object or null`);
  req(errors, Array.isArray(coverage.frames), `${p}.frames must be an array`);
  req(errors, inEnum(coverage.confidence, CONFIDENCES), `${p}.confidence invalid`);

  if (isPlainObject(coverage.freshness_gate)) {
    req(
      errors,
      inEnum(coverage.freshness_gate.computed_status, FRESHNESS_STATUSES),
      `${p}.freshness_gate.computed_status invalid`
    );

    // Invariant 4
    if (['fresh', 'fresh_new_development'].includes(coverage.freshness_gate.computed_status)) {
      const timestampEvidence = coverage.story_origin?.timestamp_evidence;
      const distinctUrlKeys = new Set((timestampEvidence || []).map((e) => e?.url_key).filter(Boolean));
      const corroborated =
        coverage.provenance !== 'none' && Array.isArray(timestampEvidence) && timestampEvidence.length >= 2 && distinctUrlKeys.size >= 2;
      req(
        errors,
        corroborated,
        `${p}.freshness_gate.computed_status is "${coverage.freshness_gate.computed_status}" but provenance/story_origin.timestamp_evidence does not show >=2 corroborating sources (fusion should have emitted "unverified_no_corroboration" instead)`
      );
    }
  }
}

function validateSourceContext(sourceContext, errors) {
  const p = 'source_context';
  if (!isPlainObject(sourceContext)) {
    errors.push(`${p} must be an object`);
    return;
  }
  req(errors, sourceContext.shown_separately === true, `${p}.shown_separately must be literal true`);
  req(errors, isPlainObject(sourceContext.publisher), `${p}.publisher must be an object`);
  req(errors, isPlainObject(sourceContext.metadata), `${p}.metadata must be an object`);
  // Invariant 9
  req(
    errors,
    Array.isArray(sourceContext.third_party_ratings) && sourceContext.third_party_ratings.length === 0,
    `${p}.third_party_ratings must be an empty array in v1`
  );
  req(errors, typeof sourceContext.note === 'string', `${p}.note must be a string`);
}

function validateAbstentions(abstentions, errors) {
  if (!Array.isArray(abstentions)) {
    errors.push('abstentions must be an array');
    return [];
  }
  abstentions.forEach((a, i) => {
    const p = `abstentions[${i}]`;
    req(errors, inEnum(a.scope, ABSTENTION_SCOPES), `${p}.scope invalid`);
    req(errors, inEnum(a.reason, ABSTENTION_REASONS), `${p}.reason invalid`);
    req(errors, typeof a.message === 'string' && a.message.length > 0, `${p}.message required`);
  });
  return abstentions;
}

function validateEngine(engine, observations, errors) {
  const p = 'engine';
  if (!isPlainObject(engine)) {
    errors.push(`${p} must be an object`);
    return;
  }
  req(errors, engine.pipeline_version === 'media-lens-0.1.0', `${p}.pipeline_version must be literal "media-lens-0.1.0"`);
  req(errors, isPlainObject(engine.preparation), `${p}.preparation must be an object`);
  if (isPlainObject(engine.preparation) && engine.preparation.extractor === 'trafilatura') {
    req(
      errors,
      engine.preparation.extractor_version === '2.2.0',
      `${p}.preparation.extractor_version must be the pinned Trafilatura version 2.2.0`
    );
    req(
      errors,
      typeof engine.preparation.extraction_status === 'string' && engine.preparation.extraction_status.length > 0,
      `${p}.preparation.extraction_status required for trafilatura`
    );
    req(
      errors,
      engine.preparation.body_sha256 === null ||
        (typeof engine.preparation.body_sha256 === 'string' && /^[0-9a-f]{64}$/.test(engine.preparation.body_sha256)),
      `${p}.preparation.body_sha256 must be a sha256 hex string or null`
    );
  }
  req(errors, isPlainObject(engine.jev), `${p}.jev must be an object`);
  req(errors, isPlainObject(engine.newsjack), `${p}.newsjack must be an object`);
  req(errors, isPlainObject(engine.fusion), `${p}.fusion must be an object`);
  req(errors, isPlainObject(engine.timestamps), `${p}.timestamps must be an object`);

  if (isPlainObject(engine.jev)) {
    req(errors, inEnum(engine.jev.mode, JEV_MODES), `${p}.jev.mode invalid`);
    req(errors, engine.jev.model_requested === 'jev-1.13.0', `${p}.jev.model_requested must be literal "jev-1.13.0"`);
    req(
      errors,
      engine.jev.model_reported === null || typeof engine.jev.model_reported === 'string',
      `${p}.jev.model_reported must be string or null`
    );
    req(
      errors,
      engine.jev.model_match === null || typeof engine.jev.model_match === 'boolean',
      `${p}.jev.model_match must be boolean or null`
    );
    // The pinned question-set hash must always be recorded, even when Jev
    // was not called for this analysis (disabled/oversized/etc.): it
    // documents which question set this build would use, not only which
    // one was actually invoked, so it is never allowed to be null.
    req(
      errors,
      typeof engine.jev.question_set_sha256 === 'string' && /^[0-9a-f]{64}$/.test(engine.jev.question_set_sha256),
      `${p}.jev.question_set_sha256 must be a 64-character hex sha256 string, never null`
    );

    // Invariant 6
    if (engine.jev.model_match === false) {
      const jevObservations = (observations || []).filter((o) => o?.evidence?.engine === 'jev');
      for (const obs of jevObservations) {
        req(
          errors,
          obs.review_status === 'needs_review',
          `engine.jev.model_match is false but observation ${obs.id || '(no id)'} is not "needs_review"`
        );
      }
    }
  }
  if (isPlainObject(engine.newsjack)) {
    req(errors, inEnum(engine.newsjack.mode, NEWSJACK_MODES), `${p}.newsjack.mode invalid`);
  }
  if (engine.classifier_dev != null) {
    req(errors, isPlainObject(engine.classifier_dev), `${p}.classifier_dev must be an object when present`);
    if (isPlainObject(engine.classifier_dev)) {
      req(errors, engine.classifier_dev.evaluation_only === true, `${p}.classifier_dev.evaluation_only must be literal true`);
      req(
        errors,
        inEnum(engine.classifier_dev.mode, ['evaluation']),
        `${p}.classifier_dev.mode must be "evaluation"`
      );
    }
  }
}

function validatePrivacy(privacy, errors) {
  const p = 'privacy';
  if (!isPlainObject(privacy)) {
    errors.push(`${p} must be an object`);
    return;
  }
  req(errors, Array.isArray(privacy.external_processing), `${p}.external_processing must be an array`);
  req(errors, privacy.clarity_isolation === 'no_private_message_path', `${p}.clarity_isolation must be literal "no_private_message_path"`);
  // Invariant 8
  req(errors, privacy.full_text_persisted === false, `${p}.full_text_persisted must be literal false in v1`);
  req(errors, privacy.retention === 'none', `${p}.retention must be literal "none" in v1`);
  req(errors, inEnum(privacy.spans_included, SPANS_INCLUDED), `${p}.spans_included invalid`);
  req(errors, typeof privacy.disclosure_shown === 'boolean', `${p}.disclosure_shown must be boolean`);
}

export function validate(graph) {
  const errors = [];

  if (!isPlainObject(graph)) {
    return { valid: false, errors: ['graph must be an object'] };
  }

  req(errors, graph.schema === 'influence-graph.v1', 'schema must be literal "influence-graph.v1"');
  req(errors, typeof graph.graph_id === 'string' && graph.graph_id.length > 0, 'graph_id required');
  req(errors, typeof graph.generated_at === 'string' && graph.generated_at.length > 0, 'generated_at required');

  validateArtifact(graph.artifact, errors);
  const spanIds = validateSpans(graph.spans, errors);
  const spanById = new Map((graph.spans || []).filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]));
  validateObservations(graph.observations, spanIds, spanById, errors);
  validateClaims(graph.claims, spanIds, errors);
  validateCoverage(graph.coverage, errors);
  validateSourceContext(graph.source_context, errors);
  const abstentions = validateAbstentions(graph.abstentions, errors);
  validateEngine(graph.engine, graph.observations, errors);
  validatePrivacy(graph.privacy, errors);

  // Invariant 5: artifact.timestamp_precision "none" requires a graph- or
  // artifact-scoped no_timestamp abstention and low coverage confidence.
  if (isPlainObject(graph.artifact) && graph.artifact.timestamp_precision === 'none') {
    req(
      errors,
      abstentions.some((a) => a?.reason === 'no_timestamp'),
      'artifact.timestamp_precision is "none" but no abstention with reason "no_timestamp" is present'
    );
    req(
      errors,
      isPlainObject(graph.coverage) && graph.coverage.confidence === 'low',
      'artifact.timestamp_precision is "none" but coverage.confidence is not "low"'
    );
  }

  // Invariant 6 (abstention half): a model mismatch must also be visible
  // as an abstention, not just as needs_review on individual observations.
  if (isPlainObject(graph.engine) && isPlainObject(graph.engine.jev) && graph.engine.jev.model_match === false) {
    req(
      errors,
      abstentions.some((a) => a?.reason === 'model_mismatch'),
      'engine.jev.model_match is false but no abstention with reason "model_mismatch" is present'
    );
  }

  // Invariant 7 + 10: forbidden keys and forbidden phrases, recursively,
  // over the whole document. No aggregate numeric field can exist anywhere
  // under a key matching the forbidden pattern (which includes "score").
  walkForbiddenKeys(graph, '$', errors);

  return { valid: errors.length === 0, errors };
}

function isRunAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
}

if (isRunAsCli()) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let graph;
    try {
      graph = JSON.parse(raw);
    } catch (err) {
      console.error(`Invalid JSON on stdin: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const { valid, errors } = validate(graph);
    if (valid) {
      console.log('VALID influence-graph.v1');
      process.exitCode = 0;
    } else {
      console.error('INVALID influence-graph.v1:');
      for (const message of errors) console.error(` - ${message}`);
      process.exitCode = 1;
    }
  });
}
