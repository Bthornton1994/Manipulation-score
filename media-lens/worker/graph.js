// Assemble the final influence-graph.v1 document: artifact, source_context,
// privacy, and engine blocks, plus evidence-only span trimming for export.
// See docs/media-lens-influence-graph-plan.md section 3.

import { randomUUID, createHash } from 'node:crypto';
import { THRESHOLDS } from './fusion.js';

function buildArtifactBlock({ prepared, paywallDetected, userAssertedPublic, consentAt, canonicalDomain }) {
  return {
    kind: prepared.artifact.kind,
    input_mode: prepared.artifact.inputMode,
    url: prepared.artifact.url,
    canonical_url: prepared.artifact.canonicalUrl,
    title: prepared.artifact.title,
    byline: prepared.artifact.byline,
    publisher: { name: prepared.artifact.publisherName ?? null, domain: canonicalDomain },
    published_at: prepared.artifact.publishedAt,
    modified_at: prepared.artifact.modifiedAt,
    timestamp_precision: prepared.artifact.timestampPrecision,
    language: prepared.artifact.language,
    text_sha256: prepared.textSha256,
    text_length_chars: prepared.textLengthChars,
    paywall_detected: paywallDetected,
    authorization: { user_asserted_public: userAssertedPublic, consent_at: consentAt }
  };
}

function domainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildSourceContext({ prepared, canonicalDomain }) {
  return {
    shown_separately: true,
    publisher: { name: prepared.artifact.publisherName ?? null, domain: canonicalDomain },
    canonical_domain: canonicalDomain,
    metadata: {
      has_byline: Boolean(prepared.artifact.byline),
      has_published_time: Boolean(prepared.artifact.publishedAt),
      has_canonical: Boolean(prepared.artifact.canonicalUrl),
      syndication_markers: []
    },
    third_party_ratings: [],
    note: 'Source context is metadata, not a manipulation judgment.'
  };
}

function evidenceSpanIds({ observations, claims }) {
  const ids = new Set();
  for (const obs of observations) for (const id of obs.span_ids) ids.add(id);
  for (const claim of claims) for (const id of claim.span_ids) ids.add(id);
  return ids;
}

/**
 * Assemble a full internal influence-graph.v1 document (spans_included: "all").
 * server.js runs this document through schema/validate.js before ever
 * sending it to a client; on failure it discards the result and serves an
 * abstention-only graph instead (see server.js's /analyze handler). The
 * browser receives this same document today (v1 has no server-side history
 * to keep evidence-only-by-default separate from the live response).
 * Export/download paths should call toEvidenceOnlyExport() before
 * persisting or downloading.
 */
export function assembleGraph({
  prepared,
  fusionResult,
  engineMeta,
  privacyMeta,
  userAssertedPublic,
  consentAt,
  disclosureShown,
  extraAbstentions = []
}) {
  const canonicalDomain = domainFromUrl(prepared.artifact.canonicalUrl || prepared.artifact.url);
  const artifact = buildArtifactBlock({
    prepared,
    paywallDetected: prepared.paywallDetected,
    userAssertedPublic,
    consentAt,
    canonicalDomain
  });

  const abstentions = [...fusionResult.abstentions, ...extraAbstentions];

  if (artifact.timestamp_precision === 'none' && !abstentions.some((a) => a.reason === 'no_timestamp')) {
    abstentions.push({
      id: 'abst-no-timestamp',
      scope: 'graph',
      target: null,
      reason: 'no_timestamp',
      message: 'Publication time not verified: this article did not provide a machine-readable publish date.'
    });
  }

  if (artifact.paywall_detected && !abstentions.some((a) => a.reason === 'paywall')) {
    abstentions.push({
      id: 'abst-paywall',
      scope: 'graph',
      target: null,
      reason: 'paywall',
      message: 'This article appears to be behind a paywall. Media Lens does not bypass paywalls, so analysis is limited to the visible excerpt.'
    });
  }

  const coverage =
    artifact.timestamp_precision === 'none' ? { ...fusionResult.coverage, confidence: 'low' } : fusionResult.coverage;

  const graph = {
    schema: 'influence-graph.v1',
    graph_id: randomUUID(),
    generated_at: new Date().toISOString(),
    artifact,
    spans: fusionResult.resolvedSpans,
    observations: fusionResult.observations,
    claims: fusionResult.claims,
    coverage,
    source_context: buildSourceContext({ prepared, canonicalDomain }),
    abstentions,
    engine: {
      pipeline_version: 'media-lens-0.1.0',
      preparation: { version: '0.1.0', extractor: engineMeta.extractor },
      jev: engineMeta.jev,
      newsjack: engineMeta.newsjack,
      fusion: { version: '0.1.0', thresholds: THRESHOLDS },
      timestamps: { started_at: engineMeta.startedAt, completed_at: engineMeta.completedAt }
    },
    privacy: {
      external_processing: privacyMeta.externalProcessing,
      clarity_isolation: 'no_private_message_path',
      full_text_persisted: false,
      spans_included: 'all',
      retention: 'none',
      disclosure_shown: disclosureShown
    }
  };

  return graph;
}

/**
 * Produce an evidence-only copy for export/download: spans not referenced
 * by any observation or claim have their text removed. Never mutates the
 * input graph.
 */
export function toEvidenceOnlyExport(graph) {
  const keepIds = evidenceSpanIds({ observations: graph.observations, claims: graph.claims });
  const spans = graph.spans.map((span) => (keepIds.has(span.id) ? { ...span } : { ...span, text: '' }));
  return {
    ...graph,
    spans,
    privacy: { ...graph.privacy, spans_included: 'evidence_only' }
  };
}
