// Pure analysis pipeline: prepared text + adapters + config -> graph.
// Host-agnostic: this function does not read process.env, does not touch
// node:http, and does not know whether it is running inside server.js, the
// analyze-fixture.js CLI, or a future server-function host. See
// docs/media-lens-influence-graph-plan.md section 1.

import { fuse } from './fusion.js';
import { assembleGraph } from './graph.js';
import { loadQuestionSet } from './adapters/jev.js';
import { loadClassifierDevTaxonomy } from './classifier-dev/taxonomy.js';
import { applyCascadeDispositions, cascadeEngineMeta, runSelectiveCascade } from './classifier-dev/cascade.js';
import { LIVE_URL_OVERSIZED_MESSAGE } from './config.js';
import { isAbortError } from './abort-utils.js';
import { enginePreparation } from './prepare.js';

const SPAN_ROLES_EXCLUDED_FROM_JEV = new Set(['boilerplate', 'byline_meta']);
const TIMED_OUT = Symbol('media-lens-analysis-timed-out');

function oversizedInputMessage(prepared) {
  if (prepared.artifact.inputMode === 'url') return LIVE_URL_OVERSIZED_MESSAGE;
  return 'This article is longer than the analysis limit, so it was not processed. Try a shorter excerpt.';
}

function oversizedSpanMessage(prepared) {
  if (prepared.artifact.inputMode === 'url') return LIVE_URL_OVERSIZED_MESSAGE;
  return 'This article has more sections than the analysis limit allows, so it was not processed.';
}

const EXTRACTION_FAILURE_MESSAGES = {
  empty: 'The article body could not be extracted, so no analysis was performed.',
  parse_failed: 'The page could not be parsed, so no analysis was performed.',
  unsupported: 'The response is not supported article HTML, so no analysis was performed.',
  error: 'Article extraction failed, so no analysis was performed.',
  not_extracted: 'The article was not extracted, so no analysis was performed.'
};

function extractionFailureMessage(status) {
  return EXTRACTION_FAILURE_MESSAGES[status] || EXTRACTION_FAILURE_MESSAGES.error;
}

function extractionBlocksAnalysis(prepared) {
  const status = prepared.extraction?.status;
  if (!status || status === 'ok' || status === 'not_html') return null;
  if (prepared.artifact.inputMode === 'pasted_text') return null;
  return status;
}

async function resolveQuestionSetHash(signal) {
  try {
    const questionSet = await loadQuestionSet({ signal });
    return questionSet.sha256;
  } catch (err) {
    if (isAbortError(err)) throw err;
    return null;
  }
}

async function buildAbstentionOnlyGraph({
  prepared,
  reason,
  message,
  config,
  userAssertedPublic = true,
  consentAt = null,
  // When a live analysis times out after Jev has already billed calls,
  // preserve that count so TypeSafe ESTIMATED budget accounting cannot
  // undercount real provider spend.
  liveJevCalls = 0
}) {
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
  const billedCalls = Number.isInteger(liveJevCalls) && liveJevCalls > 0 ? liveJevCalls : 0;

  return assembleGraph({
    prepared: { ...prepared, spans: [] },
    fusionResult,
    engineMeta: {
      preparation: enginePreparation(prepared),
      jev: {
        mode: billedCalls > 0 ? 'live' : 'disabled',
        model_requested: 'jev-1.13.0',
        model_reported: null,
        model_match: null,
        question_set: 'influence-questions.v1',
        question_set_sha256: questionSetHash,
        calls: billedCalls,
        failures: 0,
        elapsed_ms: 0
      },
      newsjack: { mode: 'disabled', version: null, artifacts: [] },
      startedAt,
      completedAt: new Date().toISOString()
    },
    privacyMeta: {
      externalProcessing:
        billedCalls > 0
          ? [
              {
                recipient: 'typesafe.ai (Jev)',
                data_sent:
                  'Prepared public span text (capped length) and immediate surrounding context. No full article is persisted.',
                occurred: true
              }
            ]
          : []
    },
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
 * @param {object|null} [args.classifierDevAdapter] - evaluation-only classifier.dev adapter
 * @param {object|null} [args.typesafeBudget] - in-process ESTIMATED monthly budget tracker
 * @param {boolean} args.userAssertedPublic
 * @param {string|null} args.consentAt
 * @param {boolean} args.disclosureShown
 */
export async function analyze({
  prepared,
  config,
  jevAdapter,
  newsjackAdapter,
  classifierDevAdapter = null,
  typesafeBudget = null,
  userAssertedPublic,
  consentAt,
  disclosureShown = true
}) {
  // N1: these early-abstention paths must record the same
  // userAssertedPublic/consentAt as every other graph, not silently drop
  // them back to the buildAbstentionOnlyGraph defaults (true / null).
  const extractionStatus = extractionBlocksAnalysis(prepared);
  if (extractionStatus) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'engine_failure',
      message: extractionFailureMessage(extractionStatus),
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (
    prepared.artifact.language === 'und' &&
    (prepared.extraction?.languageScope === 'article_html' || prepared.extraction?.languageScope === 'pasted_text')
  ) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'unsupported_language',
      message: 'This article is not identified as English, so no signals are shown.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
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
      message: oversizedInputMessage(prepared),
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (prepared.spans.length > config.limits.maxSpans) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'oversized_input',
      message: oversizedSpanMessage(prepared),
      config,
      userAssertedPublic,
      consentAt
    });
  }

  const spansForJev = prepared.spans.filter((s) => !SPAN_ROLES_EXCLUDED_FROM_JEV.has(s.role));
  const maxJevCalls = config.limits.maxJevCallsPerAnalysis;
  if (jevAdapter.mode === 'live' && spansForJev.length > maxJevCalls) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'engine_unavailable',
      message: 'This analysis would exceed the configured Jev call cap, so no manipulation analysis or score was generated.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (jevAdapter.mode === 'live' && typesafeBudget?.isStoreUnavailable?.()) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'engine_unavailable',
      message: 'The TypeSafe ESTIMATED budget record could not be read, so no live Jev analysis was performed.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (jevAdapter.mode === 'live' && typesafeBudget?.isStopped?.()) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'engine_unavailable',
      message: 'TypeSafe ESTIMATED monthly spend reached the configured stop threshold, so no live Jev analysis was performed.',
      config,
      userAssertedPublic,
      consentAt
    });
  }
  if (jevAdapter.mode === 'live' && typesafeBudget?.wouldExceed?.(spansForJev.length)) {
    return buildAbstentionOnlyGraph({
      prepared,
      reason: 'engine_unavailable',
      message: 'This analysis would exceed the configured TypeSafe ESTIMATED monthly budget, so no live Jev analysis was performed.',
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
  // Live Jev calls that completed (or were started and counted) before a
  // timeout must still reach server-side budget accounting.
  let liveJevCalls = 0;

  function pipelineTimedOut() {
    return pipelineAbortController.signal.aborted;
  }

  async function runPipeline() {
    const { signal } = pipelineAbortController;
    const jevResult = await jevAdapter.analyzeSpans(
      spansForJev,
      { kind: prepared.artifact.kind, title: prepared.artifact.title },
      { signal }
    );
    if (jevAdapter.mode === 'live' && Number.isInteger(jevResult?.calls) && jevResult.calls > 0) {
      liveJevCalls = jevResult.calls;
    }
    if (pipelineTimedOut()) return TIMED_OUT;

    if (jevAdapter.mode === 'live' && (jevResult.capReached || jevResult.calls > maxJevCalls)) {
      return buildAbstentionOnlyGraph({
        prepared,
        reason: 'engine_unavailable',
        message: 'This analysis exceeded the configured Jev call cap, so no manipulation analysis or score was generated.',
        config,
        userAssertedPublic,
        consentAt
      });
    }

    if (pipelineTimedOut()) return TIMED_OUT;

    let newsjackResult;
    try {
      newsjackResult = await newsjackAdapter.getStoryContext({
        url: prepared.artifact.url,
        canonical_url: prepared.artifact.canonicalUrl,
        title: prepared.artifact.title,
        published_at: prepared.artifact.publishedAt,
        signal
      });
    } catch (err) {
      if (isAbortError(err) || pipelineTimedOut()) return TIMED_OUT;
      throw err;
    }
    if (pipelineTimedOut()) return TIMED_OUT;

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

    let cascadeResult = null;
    const cascadeStarted = Date.now();
    const classifierDevOn = Boolean(classifierDevAdapter?.enabled);
    if (classifierDevOn) {
      if (pipelineTimedOut()) return TIMED_OUT;
      let taxonomy;
      try {
        taxonomy = await loadClassifierDevTaxonomy({ signal });
      } catch (err) {
        if (isAbortError(err) || pipelineTimedOut()) return TIMED_OUT;
        throw err;
      }
      if (pipelineTimedOut()) return TIMED_OUT;
      cascadeResult = await runSelectiveCascade({
        spans: spansForJev,
        jevResult,
        adapter: classifierDevAdapter,
        taxonomyVersion: taxonomy.versionId,
        minConfidence: config.classifierDev?.minConfidenceForEscalation,
        injectedSpanIds: fusionResult.injectedSpanIds,
        signal,
        tier: config.classifierDev?.tier
      });
      if (pipelineTimedOut()) return TIMED_OUT;
      applyCascadeDispositions(fusionResult, cascadeResult);
    }
    const cascadeElapsedMs = Date.now() - cascadeStarted;

    const completedAt = new Date().toISOString();
    let questionSetHash;
    try {
      questionSetHash = await resolveQuestionSetHash(signal);
    } catch (err) {
      if (isAbortError(err) || pipelineTimedOut()) return TIMED_OUT;
      throw err;
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
    if (classifierDevOn) {
      externalProcessing.push({
        recipient: 'classifier.dev (evaluation-only)',
        data_sent:
          'Minimum public span text (capped length) for selective escalation only. Private or pasted sensitive content is prohibited. Upstream retention and training terms are UNVERIFIED.',
        occurred: (cascadeResult?.networkCalls || 0) > 0
      });
    }

    return assembleGraph({
      prepared,
      fusionResult,
      engineMeta: {
        preparation: enginePreparation(prepared),
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
        classifierDev: cascadeEngineMeta(cascadeResult, { enabled: classifierDevOn, elapsedMs: cascadeElapsedMs }),
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

  const pipelinePromise = runPipeline();
  try {
    const result = await Promise.race([pipelinePromise, timeoutPromise]);
    if (result === TIMED_OUT) {
      pipelineAbortController.abort();
      // Prefer calls already counted after Jev returned. If timeout fired
      // mid-Jev, allow a short grace for a well-behaved adapter to settle
      // and report its calls — but never wait forever (hanging adapters
      // must not block the timeout abstention).
      if (liveJevCalls === 0 && jevAdapter.mode === 'live') {
        await Promise.race([
          pipelinePromise.then(
            () => {},
            () => {}
          ),
          new Promise((resolve) => setTimeout(resolve, 100))
        ]);
      } else {
        // Keep the losing pipeline from becoming an unhandled rejection if
        // it later throws after abort, without delaying the response.
        pipelinePromise.then(
          () => {},
          () => {}
        );
      }
      return buildAbstentionOnlyGraph({
        prepared,
        reason: 'engine_unavailable',
        message: 'The analysis took longer than the configured limit and was stopped before completion.',
        config,
        userAssertedPublic,
        consentAt,
        liveJevCalls: jevAdapter.mode === 'live' ? liveJevCalls : 0
      });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export { buildAbstentionOnlyGraph, LIVE_URL_OVERSIZED_MESSAGE, oversizedInputMessage };
