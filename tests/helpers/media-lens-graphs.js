// Influence graphs shaped like real live-host responses, built with the
// worker's own functions (fusion rules, graph assembly, abstention builder)
// rather than hand-written JSON, so renderer tests follow worker changes.

import { fuse } from '../../media-lens/worker/fusion.js';
import { assembleGraph } from '../../media-lens/worker/graph.js';
import { analyze, buildAbstentionOnlyGraph } from '../../media-lens/worker/analyze.js';
import { createNewsjackAdapter } from '../../media-lens/worker/adapters/newsjack.js';
import { emptyPreparedArtifactStub, enginePreparation } from '../../media-lens/worker/prepare.js';
import { loadQuestionSet } from '../../media-lens/worker/adapters/jev.js';
import { loadConfig } from '../../media-lens/worker/config.js';

export const LIVE_ARTICLE_URL = 'https://en.wikipedia.org/wiki/Harbor_Bridge_Synthetic';
export const UNATTRIBUTED_QUOTE = 'It will never close again';

function preparedLiveArticle() {
  const rows = [
    ['headline', 'Harbor Bridge Synthetic', 'html_structure', { speaker: null, cue: null }],
    [
      'authorial',
      'The Harbor Bridge is a made-up rail and road bridge used as a test article for this preview.',
      'default',
      { speaker: null, cue: null }
    ],
    ['quoted', UNATTRIBUTED_QUOTE, 'quote_marks', { speaker: null, cue: null }],
    ['quoted', 'We expect the deck repairs to finish in the spring', 'attribution_cue', { speaker: 'the harbor engineer', cue: 'said' }]
  ];
  let offset = 0;
  const spans = rows.map(([role, text, roleBasis, attribution], index) => {
    const span = {
      id: `span-${index + 1}`,
      start: offset,
      end: offset + text.length,
      text,
      paragraph_index: index,
      role,
      role_basis: roleBasis,
      attribution
    };
    offset += text.length + 1;
    return span;
  });
  return {
    preparedText: spans.map((span) => span.text).join('\n'),
    textSha256: '0'.repeat(64),
    textLengthChars: 600,
    spans,
    claimCandidates: [{ spanId: 'span-2', text: spans[1].text, kind: 'event', attribution: 'authorial' }],
    paywallDetected: false,
    extraction: {
      status: 'ok',
      languageScope: 'article_html',
      extractorVersion: '2.2.0',
      languageDetectorVersion: 'test',
      bodySha256: null,
      contentType: 'text/html',
      fetchStatus: 200,
      fetchedAt: null
    },
    artifact: {
      kind: 'article',
      inputMode: 'url',
      url: LIVE_ARTICLE_URL,
      canonicalUrl: LIVE_ARTICLE_URL,
      title: 'Harbor Bridge Synthetic',
      byline: null,
      publisherName: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language: 'en'
    }
  };
}

/**
 * A live URL result as the worker builds it when no coverage source exists:
 * Newsjack disabled (provenance "none"), Jev live with no language signal,
 * and the deterministic unattributed-quote rule firing once.
 */
export async function liveUrlGraph() {
  const prepared = preparedLiveArticle();
  const newsjackResult = await createNewsjackAdapter({ mode: 'disabled' }).getStoryContext({});
  const fusionResult = fuse({
    spans: prepared.spans,
    claimCandidates: prepared.claimCandidates,
    artifactHasUrl: true,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: prepared.spans.length,
    jevMode: 'live',
    jevModelMatch: true,
    newsjackResult
  });
  const now = new Date().toISOString();
  return assembleGraph({
    prepared,
    fusionResult,
    engineMeta: {
      preparation: enginePreparation(prepared),
      jev: {
        mode: 'live',
        model_requested: 'jev-1.13.0',
        model_reported: 'jev-1.13.0',
        model_match: true,
        question_set: 'influence-questions.v1',
        question_set_sha256: (await loadQuestionSet()).sha256,
        calls: prepared.spans.length,
        failures: 0,
        elapsed_ms: 10
      },
      newsjack: { mode: 'disabled', version: null, artifacts: [] },
      startedAt: now,
      completedAt: now
    },
    privacyMeta: { externalProcessing: [] },
    userAssertedPublic: true,
    consentAt: now,
    disclosureShown: true
  });
}

/** The worker's real abstention-only graph for a live URL request. */
export async function liveAbstentionGraph({ reason, message }) {
  const prepared = emptyPreparedArtifactStub({ inputMode: 'url', url: LIVE_ARTICLE_URL, fetchStatus: 'TIMEOUT' });
  return buildAbstentionOnlyGraph({ prepared, reason, message, config: loadConfig({}), consentAt: new Date().toISOString() });
}

/**
 * The worker's per-analysis timeout after live Jev calls were made: analyze()
 * runs with a live Jev adapter that answers at once and a story-context step
 * that never settles, so the timeout fires with the Jev calls already
 * counted. The result is an abstention-only graph with engine.jev.mode
 * "live", engine.jev.calls > 0, and an external_processing entry with
 * occurred true.
 */
export async function liveTimeoutAbstentionGraph({ calls = 3 } = {}) {
  const config = loadConfig({});
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 30 };
  const jevAdapter = {
    mode: 'live',
    async analyzeSpans() {
      return { calls, answersBySpanId: new Map(), failedSpanIds: new Set(), modelMatch: true, capReached: false };
    }
  };
  const newsjackAdapter = {
    mode: 'disabled',
    getStoryContext() {
      return new Promise(() => {});
    }
  };
  return analyze({
    prepared: preparedLiveArticle(),
    config,
    jevAdapter,
    newsjackAdapter,
    userAssertedPublic: true,
    consentAt: new Date().toISOString()
  });
}

/**
 * Early-exit graphs from the worker's analyze(): each returns before any
 * adapter runs, so the adapters here are never called.
 */
export async function earlyExitGraphs() {
  const config = loadConfig({});
  const unusedAdapter = {
    mode: 'disabled',
    analyzeSpans() {
      throw new Error('adapter must not run');
    },
    getStoryContext() {
      throw new Error('adapter must not run');
    }
  };
  const base = preparedLiveArticle();
  const cases = {
    engine_failure: { ...base, extraction: { ...base.extraction, status: 'parse_failed' } },
    unsupported_language: { ...base, artifact: { ...base.artifact, language: 'und' } },
    insufficient_text: { ...base, textLengthChars: 20 },
    oversized_input: { ...base, textLengthChars: config.limits.maxPreparedTextChars + 1 }
  };
  const out = {};
  for (const [reason, prepared] of Object.entries(cases)) {
    out[reason] = await analyze({
      prepared,
      config,
      jevAdapter: unusedAdapter,
      newsjackAdapter: unusedAdapter,
      userAssertedPublic: true,
      consentAt: new Date().toISOString()
    });
  }
  return out;
}
