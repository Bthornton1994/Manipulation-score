// Pure analysis pipeline: prepared text + adapters + config -> graph.
// Host-agnostic: this function does not read process.env, does not touch
// node:http, and does not know whether it is running inside server.js, the
// analyze-fixture.js CLI, or a future server-function host. See
// docs/media-lens-influence-graph-plan.md section 1.

import { fuse } from './fusion.js';
import { assembleGraph } from './graph.js';
import { loadQuestionSet } from './adapters/jev.js';

const SPAN_ROLES_EXCLUDED_FROM_JEV = new Set(['boilerplate', 'byline_meta']);

function buildAbstentionOnlyGraph({ prepared, reason, message, config }) {
  const startedAt = new Date().toISOString();
  const fusionResult = {
    resolvedSpans: [],
    observations: [],
    claims: [],
    coverage: { status: 'not_requested', provenance: 'none', story_origin: null, freshness_gate: null, cluster: null, frames: [], confidence: 'low' },
    abstentions: [{ id: `abst-${reason}`, scope: 'graph', target: null, reason, message }]
  };

  return assembleGraph({
    prepared: { ...prepared, spans: [] },
    fusionResult,
    engineMeta: {
      extractor: prepared.artifact.inputMode === 'pasted_text' ? 'pasted' : prepared.artifact.inputMode === 'fixture' ? 'fixture' : 'html-lite',
      jev: {
        mode: 'disabled',
        model_requested: 'jev-1.13.0',
        model_reported: null,
        model_match: null,
        question_set: 'influence-questions.v1',
        question_set_sha256: null,
        calls: 0,
        failures: 0,
        elapsed_ms: 0
      },
      newsjack: { mode: 'disabled', version: null, artifacts: [] },
      startedAt,
      completedAt: new Date().toISOString()
    },
    privacyMeta: { externalProcessing: [] },
    userAssertedPublic: true,
    consentAt: null,
    disclosureShown: true
  });
}

/**
 * Run the full analysis pipeline.
 *
 * @param {object} args
 * @param {object} args.prepared - output of prepare.js (prepareFromHtml/prepareFromPastedText)
 * @param {object} args.config - config from worker/config.js
 * @param {object} args.jevAdapter - created by adapters/jev.js createJevAdapter
 * @param {object} args.newsjackAdapter - created by adapters/newsjack.js createNewsjackAdapter
 * @param {boolean} args.userAssertedPublic
 * @param {string|null} args.consentAt
 * @param {boolean} args.disclosureShown
 */
export async function analyze({ prepared, config, jevAdapter, newsjackAdapter, userAssertedPublic, consentAt, disclosureShown = true }) {
  if (prepared.textLengthChars < config.limits.minAnalyzableChars) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'insufficient_text',
      message: 'This excerpt is too short to analyze reliably, so no signals are shown.',
      config
    });
  }
  if (prepared.textLengthChars > config.limits.maxPreparedTextChars) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'oversized_input',
      message: 'This article is longer than the analysis limit, so it was not processed. Try a shorter excerpt.',
      config
    });
  }
  if (prepared.spans.length > config.limits.maxSpans) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'oversized_input',
      message: 'This article has more sections than the analysis limit allows, so it was not processed.',
      config
    });
  }

  const startedAt = new Date().toISOString();

  const spansForJev = prepared.spans.filter((s) => !SPAN_ROLES_EXCLUDED_FROM_JEV.has(s.role));
  const jevResult = await jevAdapter.analyzeSpans(spansForJev, {
    kind: prepared.artifact.kind,
    title: prepared.artifact.title
  });

  const newsjackResult = await newsjackAdapter.getStoryContext({
    url: prepared.artifact.url,
    canonical_url: prepared.artifact.canonicalUrl,
    title: prepared.artifact.title,
    published_at: prepared.artifact.publishedAt
  });

  const fusionResult = fuse({
    spans: prepared.spans,
    claimCandidates: prepared.claimCandidates,
    artifactHasUrl: Boolean(prepared.artifact.url || prepared.artifact.canonicalUrl),
    jevAnswersBySpanId: jevResult.answersBySpanId,
    jevFailedSpanIds: jevResult.failedSpanIds,
    jevCalls: jevResult.calls,
    jevMode: jevAdapter.mode,
    jevModelMatch: jevResult.modelMatch,
    newsjackResult
  });

  const completedAt = new Date().toISOString();

  let questionSetHash = null;
  try {
    const questionSet = await loadQuestionSet();
    questionSetHash = questionSet.sha256;
  } catch {
    questionSetHash = null;
  }

  const externalProcessing = [];
  if (jevAdapter.mode === 'live') {
    externalProcessing.push({
      recipient: 'typesafe.ai (Jev)',
      data_sent: 'Prepared public span text (capped length) and immediate surrounding context. No full article is persisted.',
      occurred: jevResult.calls > 0
    });
  }
  if (newsjackAdapter.mode === 'artifacts') {
    externalProcessing.push({
      recipient: 'newsjack CLI (local)',
      data_sent: 'URL/title/published_at matched against operator-provided Newsjack run artifacts already on disk. No network call is made by this worker.',
      occurred: newsjackResult.provenance === 'newsjack_artifacts'
    });
  }

  return assembleGraph({
    prepared,
    fusionResult,
    engineMeta: {
      extractor: prepared.artifact.inputMode === 'pasted_text' ? 'pasted' : prepared.artifact.inputMode === 'fixture' ? 'fixture' : 'html-lite',
      jev: {
        mode: jevAdapter.mode,
        model_requested: 'jev-1.13.0',
        model_reported: jevResult.modelReported,
        model_match: jevResult.modelMatch,
        question_set: 'influence-questions.v1',
        question_set_sha256: questionSetHash,
        calls: jevResult.calls,
        failures: jevResult.failures,
        elapsed_ms: jevResult.elapsedMs
      },
      newsjack: {
        mode: newsjackAdapter.mode,
        version: null,
        artifacts: newsjackResult.provenance === 'newsjack_artifacts' ? ['candidates.json'] : []
      },
      startedAt,
      completedAt
    },
    privacyMeta: { externalProcessing },
    userAssertedPublic,
    consentAt,
    disclosureShown
  });
}

export { buildAbstentionOnlyGraph };
