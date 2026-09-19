// Pure analysis pipeline: prepared text + adapters + config -> graph.
// Host-agnostic: this function does not read process.env, does not touch
// node:http, and does not know whether it is running inside server.js, the
// analyze-fixture.js CLI, or a future server-function host. See
// docs/media-lens-influence-graph-plan.md section 1.

import { fuse } from './fusion.js';
import { assembleGraph } from './graph.js';
import { loadQuestionSet } from './adapters/jev.js';

const SPAN_ROLES_EXCLUDED_FROM_JEV = new Set(['boilerplate', 'byline_meta']);
const TIMED_OUT = Symbol('media-lens-analysis-timed-out');

async function resolveQuestionSetHash() {
  try {
    const questionSet = await loadQuestionSet();
    return questionSet.sha256;
  } catch {
    return null;
  }
}

async function buildAbstentionOnlyGraph({ prepared, reason, message, config, userAssertedPublic = true, consentAt = null }) {
  const startedAt = new Date().toISOString();
  const fusionResult = {
    resolvedSpans: [],
    observations: [],
    claims: [],
    coverage: { status: 'not_requested', provenance: 'none', story_origin: null, freshness_gate: null, cluster: null, frames: [], confidence: 'low' },
    abstentions: [{ id: `abst-${reason}`, scope: 'graph', target: null, reason, message }]
  };

  // The question-set hash documents which pinned question set this build
  // would use; it is always recorded, even when Jev was not actually
  // called for this analysis (schema/validate.js forbids it being null).
  const questionSetHash = await resolveQuestionSetHash();

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
        question_set_sha256: questionSetHash,
        calls: 0,
        failures: 0,
        elapsed_ms: 0
      },
      newsjack: { mode: 'disabled', version: null, artifacts: [] },
      startedAt,
      completedAt: new Date().toISOString()
    },
    privacyMeta: { externalProcessing: [] },
    userAssertedPublic,
    consentAt,
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
  // N1: these early-abstention paths must record the same
  // userAssertedPublic/consentAt as every other graph, not silently drop
  // them back to the buildAbstentionOnlyGraph defaults (true / null).
  if (prepared.textLengthChars < config.limits.minAnalyzableChars) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'insufficient_text',
      message: 'This excerpt is too short to analyze reliably, so no signals are shown.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (prepared.textLengthChars > config.limits.maxPreparedTextChars) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'oversized_input',
      message: 'This article is longer than the analysis limit, so it was not processed. Try a shorter excerpt.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (prepared.spans.length > config.limits.maxSpans) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'oversized_input',
      message: 'This article has more sections than the analysis limit allows, so it was not processed.',
      config,
      userAssertedPublic,
      consentAt
    });
  }

  const startedAt = new Date().toISOString();
  // N2: this signal is aborted the instant the per-analysis timeout below
  // fires, so an in-flight (and any not-yet-started) Jev call/retry stops
  // immediately rather than continuing to run and retry in the background
  // after the caller has already been served an abstention graph.
  const pipelineAbortController = new AbortController();

  async function runPipeline() {
    const spansForJev = prepared.spans.filter((s) => !SPAN_ROLES_EXCLUDED_FROM_JEV.has(s.role));
    const jevResult = await jevAdapter.analyzeSpans(
      spansForJev,
      { kind: prepared.artifact.kind, title: prepared.artifact.title },
      { signal: pipelineAbortController.signal }
    );

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
    const questionSetHash = await resolveQuestionSetHash();

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

  // H2: race the whole jev -> newsjack -> fusion -> graph pipeline against
  // config.limits.perAnalysisTimeoutMs. This is a safety net independent
  // of each adapter's own per-call timeout (jevCallTimeoutMs): if any
  // underlying call ignores its own abort signal and never settles, the
  // configured per-analysis limit is what actually bounds the response
  // time, rather than the limit being advertised by /health but unused.
  const timeoutMs = config.limits.perAnalysisTimeoutMs;
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });

  try {
    const result = await Promise.race([runPipeline(), timeoutPromise]);
    if (result === TIMED_OUT) {
      pipelineAbortController.abort();
      return buildAbstentionOnlyGraph({
        prepared,
        reason: 'engine_unavailable',
        message: 'The analysis took longer than the configured limit and was stopped before completion.',
        config,
        userAssertedPublic,
        consentAt
      });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export { buildAbstentionOnlyGraph };
