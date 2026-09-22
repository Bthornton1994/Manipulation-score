// Media Lens renderer. The browser talks to the worker through the same
// origin when this page is served by the approved live host, or through the
// loopback worker during local fixture development. This file never reads
// Node-style environment variables, never writes to localStorage,
// sessionStorage, or indexedDB, and never persists full article text.

const LOCAL_WORKER_BASE_URL = 'http://127.0.0.1:8787';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LIVE_SCOPE_MESSAGE = 'Live URL is experimental and not production-ready for general use.';
const OVERSIZED_INPUT_MESSAGE =
  'This public page is too long for Media Lens live analysis. No manipulation analysis or score was generated. Try a shorter public article.';
const CANCELLED_MESSAGE = 'Analysis cancelled. Nothing was stored.';
const LOADING_STAGES = [
  'Requesting article',
  'Preparing evidence',
  'Evaluating signals',
  'Building the result'
];
const STAGE_DELAYS_MS = [0, 1600, 4000, 8000];

const ALLOWED_UI_PHRASES = new Set([
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
]);

// The stored ui_phrase "Observed influence signal" does not encode strength.
// Golden graphs still use that phrase for candidate rows. The public chip is
// chosen from strength so a candidate is never labeled as observed. More
// specific allowed phrases stay as written.
const STRENGTH_DISPLAY_LABELS = Object.freeze({
  observed: 'Observed influence signal',
  candidate: 'Possible influence signal'
});

// Labels copied from schema/taxonomy.js. That module is not a browser-served
// file on the live host, so the renderer keeps a local map of the same ids.
const TAXONOMY = Object.freeze({
  loaded_moralized: {
    label: 'Loaded or moralized language',
    explanation: 'Word choices that carry a moral judgment instead of a neutral description of the same fact.'
  },
  fear_threat: {
    label: 'Fear or threat framing',
    explanation: 'Language that emphasizes danger or harm to create alarm about the subject.'
  },
  urgency: {
    label: 'Urgency framing',
    explanation: 'Language that compresses the time a reader has to think, verify, or act.'
  },
  false_dilemma: {
    label: 'False dilemma',
    explanation: 'Presents only two options when more may exist.'
  },
  identity_ingroup: {
    label: 'Identity or in-group framing',
    explanation: 'Appeals to group membership or loyalty rather than the substance of a claim.'
  },
  scapegoating_dehumanizing: {
    label: 'Scapegoating or dehumanizing language',
    explanation: 'Assigns blame to a person or group in terms that strip away their individuality.'
  },
  certainty_beyond_evidence: {
    label: 'Certainty beyond evidence',
    explanation: 'States a conclusion with more confidence than the cited support would justify.'
  },
  vague_authority: {
    label: 'Vague authority',
    explanation: 'Cites an unnamed or unspecific authority ("experts say", "officials confirm") without a checkable source.'
  },
  anecdote_generalization: {
    label: 'Anecdote generalized',
    explanation: 'Extends a single story or example into a broader claim about a group or trend.'
  },
  selective_context_candidate: {
    label: 'Possible selective-context candidate',
    explanation: 'A detail present in one account of a story is missing from another, which may or may not change the meaning.'
  },
  bandwagon: {
    label: 'Bandwagon appeal',
    explanation: 'Suggests a position is correct mainly because many people hold it.'
  },
  adversarial_conflict_framing: {
    label: 'Adversarial or conflict framing',
    explanation: 'Casts a situation primarily as a fight between opposing sides rather than describing what happened.'
  }
});

// In-repo story catalog. Titles and domains are checked against the golden
// graphs in tests. Notes describe the fixture. They are not live coverage.
const FIXTURE_STORIES = Object.freeze([
  Object.freeze({
    id: 'synthetic-01-quoted-vs-authorial',
    title: "Council approves downtown drainage upgrade",
    domain: 'fictional-daily.example',
    byline: 'Jordan Reyes',
    topics: ['drainage', 'council', 'quoted', 'authorial', 'flooding'],
    lane: 'quoted-language',
    coverageCount: Object.freeze({ members: 1, independent: 1, syndicated: 0, frames: 0 }),
    fixtureNote: 'Fixture example. Quoted urgency stays separate from the writer wording.'
  }),
  Object.freeze({
    id: 'synthetic-02-syndicated-cluster',
    title: "Regional transit agency proposes fare increase",
    domain: 'fictional-daily.example',
    byline: 'Priya Nandan',
    topics: ['transit', 'fare', 'syndicated', 'cluster'],
    lane: 'syndicated-cluster',
    coverageCount: Object.freeze({ members: 5, independent: 2, syndicated: 3, frames: 0 }),
    fixtureNote: 'Fixture example. A same-story cluster with syndicated repetition counted apart from independent reports.'
  }),
  Object.freeze({
    id: 'synthetic-03-no-timestamp',
    title: "Neighborhood group organizes cleanup weekend",
    domain: 'fictional-daily.example',
    byline: 'Sam Okafor',
    topics: ['cleanup', 'neighborhood', 'timestamp'],
    lane: 'coverage-gap',
    coverageCount: null,
    fixtureNote: 'Fixture example. No publish timestamp and no provenance record.'
  }),
  Object.freeze({
    id: 'synthetic-04-injection',
    title: "Housing permits rise this quarter",
    domain: 'fictional-daily.example',
    byline: 'Dana Whitfield',
    topics: ['housing', 'permits', 'instruction'],
    lane: 'coverage-gap',
    coverageCount: null,
    fixtureNote: 'Fixture example. Instruction-like text in the article is not treated as a command.'
  }),
  Object.freeze({
    id: 'synthetic-05-paywall',
    title: "Exclusive: inside the port authority's budget talks",
    domain: 'fictional-daily.example',
    byline: 'Elena Voss',
    topics: ['paywall', 'budget', 'port'],
    lane: 'coverage-gap',
    coverageCount: null,
    fixtureNote: 'Fixture example. A paywalled excerpt abstains instead of fetching the rest.'
  }),
  Object.freeze({
    id: 'synthetic-06-short-excerpt',
    title: "Brief: road closure this weekend",
    domain: 'fictional-daily.example',
    byline: '',
    topics: ['road', 'closure', 'short'],
    lane: 'coverage-gap',
    coverageCount: null,
    fixtureNote: 'Fixture example. The excerpt is too short for a language or claim record.'
  })
]);

const FIXTURE_LANES = Object.freeze([
  Object.freeze({ id: 'all', label: 'All fixtures' }),
  Object.freeze({ id: 'quoted-language', label: 'Quoted language' }),
  Object.freeze({ id: 'syndicated-cluster', label: 'Syndicated cluster' }),
  Object.freeze({ id: 'coverage-gap', label: 'Coverage gap' })
]);

const FIXTURE_GRAPH_ID = /^synthetic-\d{2}-[a-z0-9-]+$/;
const NOT_RECORDED = 'Not recorded';
const OMISSION_EMPTY_COPY =
  'No omission candidate was recorded. That is not proof a fact was left out.';
const ALTERNATIVE_READINGS_EMPTY = 'No alternative reading was recorded for this result.';
const RELATION_LABELS = Object.freeze({
  surfaced: 'Surfaced article',
  same_story: 'Same story',
  syndicated: 'Syndicated repetition',
  different_story: 'Different story',
  unclear: 'Unclear relation'
});

let currentGraph = null;
let activeLane = 'all';
let compareMode = 'all';
let liveUrlReady = false;
let isSubmitting = false;
let lastPayload = null;
let pendingPayload = null;
let analyzeAbort = null;
let stageTimer = null;
let consentCheckedAt = null;
let consentTrigger = null;

function isLocalPreviewPage() {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'file:' || LOCAL_HOSTNAMES.has(window.location.hostname);
}

function isFixturePreviewPage() {
  if (typeof document === 'undefined') return false;
  const value = document.querySelector('meta[name="media-lens-fixture-preview"]')?.content?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function normalizeBaseUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function resolveWorkerBaseUrl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  const configured = document.querySelector('meta[name="media-lens-api-base"]')?.content?.trim();
  const configuredUrl = normalizeBaseUrl(configured);
  if (configuredUrl) return configuredUrl;
  if (isLocalPreviewPage()) return LOCAL_WORKER_BASE_URL;
  return window.location.origin;
}

const IS_LOCAL_PREVIEW = isLocalPreviewPage();
const IS_FIXTURE_PREVIEW = isFixturePreviewPage();
const WORKER_BASE_URL = resolveWorkerBaseUrl();

function byId(id) {
  return document.getElementById(id);
}

function updateUrlInputAvailability() {
  const articleUrl = byId('article-url');
  const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'url';
  if (articleUrl) articleUrl.disabled = mode !== 'url' || IS_LOCAL_PREVIEW || IS_FIXTURE_PREVIEW || !liveUrlReady;
}

function currentMode() {
  return document.querySelector('input[name="input-mode"]:checked')?.value || 'url';
}

function hasUsableInput() {
  const mode = currentMode();
  const articleUrl = byId('article-url')?.value.trim() || '';
  return (
    mode === 'fixture' ||
    (mode === 'pasted_text' && byId('pasted-text')?.value.trim()) ||
    (mode === 'url' && articleUrl && liveUrlReady)
  );
}

function updateSubmitEnabled() {
  const consent = byId('consent-checkbox');
  const submit = byId('analyze-submit');
  const continueBtn = byId('analyze-continue');
  const hasInput = hasUsableInput();
  submit.disabled = isSubmitting || !consent.checked || !hasInput;
  if (continueBtn) continueBtn.disabled = isSubmitting || !hasInput;
  if (consent.checked && !consentCheckedAt) consentCheckedAt = new Date().toISOString();
  if (!consent.checked) consentCheckedAt = null;
}

function setupInputModeToggle() {
  const radios = document.querySelectorAll('input[name="input-mode"]');
  const fixtureField = byId('fixture-field');
  const pastedField = byId('pasted-text-field');
  const urlField = byId('url-field');
  const fixtureRadio = document.querySelector('input[name="input-mode"][value="fixture"]');
  const pastedRadio = document.querySelector('input[name="input-mode"][value="pasted_text"]');
  const urlRadio = document.querySelector('input[name="input-mode"][value="url"]');
  const articleUrl = byId('article-url');
  const sampleAnalyze = byId('sample-analyze');

  if (IS_FIXTURE_PREVIEW) {
    pastedRadio.disabled = true;
    pastedRadio.closest('label').hidden = true;
    urlRadio.disabled = true;
    fixtureRadio.checked = true;
    if (sampleAnalyze) {
      sampleAnalyze.hidden = false;
      sampleAnalyze.textContent = 'Analyze this example';
    }
    const marker = byId('fixture-preview-marker');
    if (marker) marker.hidden = false;
  } else if (!IS_LOCAL_PREVIEW) {
    fixtureRadio.disabled = true;
    pastedRadio.disabled = true;
    fixtureRadio.closest('label').hidden = true;
    pastedRadio.closest('label').hidden = true;
    fixtureRadio.closest('fieldset').hidden = true;
    urlRadio.checked = true;
  } else {
    if (sampleAnalyze) sampleAnalyze.hidden = false;
  }

  function apply() {
    const mode = currentMode();
    fixtureField.hidden = mode !== 'fixture';
    pastedField.hidden = mode !== 'pasted_text';
    urlField.hidden = mode !== 'url';
    const urlHelp = byId('article-url-help');
    if (urlHelp) urlHelp.hidden = mode !== 'url';
    updateUrlInputAvailability();
    updateSubmitEnabled();
  }

  radios.forEach((radio) => radio.addEventListener('change', apply));
  articleUrl.addEventListener('input', updateSubmitEnabled);
  apply();
}

async function checkHealth() {
  const statusEl = byId('worker-status');
  const textEl = byId('worker-status-text');
  try {
    const res = await fetch(`${WORKER_BASE_URL}/health`, { method: 'GET' });
    if (!res.ok) throw new Error(`health check failed with status ${res.status}`);
    const health = await res.json();
    liveUrlReady =
      !IS_LOCAL_PREVIEW &&
      !IS_FIXTURE_PREVIEW &&
      health.mode === 'live' &&
      health.liveEnabled === true &&
      health.liveUrlEnabled === true &&
      health.killSwitch !== true &&
      health.jev?.hasApiKey === true;
    statusEl.dataset.state = 'ready';
    if (IS_FIXTURE_PREVIEW) {
      liveUrlReady = false;
      textEl.textContent = 'Fixture preview. Live URL is disabled and Jev is not configured.';
    } else if (IS_LOCAL_PREVIEW) {
      textEl.textContent = `Worker reachable: ${health.mode} mode.`;
    } else if (health.killSwitch === true) {
      textEl.textContent = 'Live analysis is paused by the operator kill switch.';
      statusEl.dataset.state = 'error';
    } else if (liveUrlReady) {
      textEl.textContent = `Live URL ready for approved public sources. Jev only. ${LIVE_SCOPE_MESSAGE}`;
    } else {
      textEl.textContent = 'Worker reachable, but live URL analysis is not currently available.';
      statusEl.dataset.state = 'error';
    }
    updateUrlInputAvailability();
    updateSubmitEnabled();
    return true;
  } catch {
    liveUrlReady = false;
    if (IS_LOCAL_PREVIEW || IS_FIXTURE_PREVIEW) {
      statusEl.dataset.state = 'offline';
      textEl.textContent =
        'Fixture stories on this page do not need the worker. Live URL analysis is unavailable until a local worker is running.';
    } else {
      statusEl.dataset.state = 'error';
      textEl.textContent = 'The Media Lens service is unavailable. Try again later.';
    }
    updateUrlInputAvailability();
    updateSubmitEnabled();
    return false;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chip(text, attrs = {}) {
  const attrString = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<span class="ml-chip" ${attrString}>${escapeHtml(text)}</span>`;
}

function findSpanText(graph, spanIds) {
  return spanIds
    .map((id) => graph.spans.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => s.text)
    .join(' ... ');
}

function formatSignal(signal) {
  const entry = TAXONOMY[signal];
  if (entry) return entry;
  return {
    label: String(signal || '').replace(/_/g, ' '),
    explanation: ''
  };
}

function observationDisplayLabel(obs) {
  const stored = typeof obs?.ui_phrase === 'string' && ALLOWED_UI_PHRASES.has(obs.ui_phrase) ? obs.ui_phrase : null;
  if (stored === STRENGTH_DISPLAY_LABELS.observed) {
    return STRENGTH_DISPLAY_LABELS[obs?.strength] || stored;
  }
  return stored || 'Insufficient context';
}

function renderObservation(graph, obs) {
  const uiPhrase = observationDisplayLabel(obs);
  const spanText = obs.localization === 'span' ? findSpanText(graph, obs.span_ids) : null;
  const taxonomy = formatSignal(obs.signal);
  const attribution = obs.authorial_attribution ? obs.authorial_attribution.replace(/_/g, ' ') : '';
  return `
    <li class="ml-observation">
      <div class="ml-observation-head">
        ${chip(uiPhrase, { 'data-strength': obs.strength })}
        ${obs.review_status === 'needs_review' ? chip('Needs review', { 'data-review': 'needs_review' }) : ''}
        ${chip(taxonomy.label)}
      </div>
      ${spanText ? `<p class="ml-observation-quote">&ldquo;${escapeHtml(spanText)}&rdquo;</p>` : ''}
      ${taxonomy.explanation ? `<p class="ml-observation-explain">${escapeHtml(taxonomy.explanation)}</p>` : ''}
      <p class="ml-observation-explain">Signal: ${escapeHtml(obs.signal.replace(/_/g, ' '))}${
        attribution ? ` · Attribution: ${escapeHtml(attribution)}` : ''
      }${obs.evidence?.engine ? ` · Evidence engine: ${escapeHtml(obs.evidence.engine)}` : ''}</p>
    </li>
  `;
}

function renderClaim(graph, claim) {
  const supportLabel = claim.support === 'not_checked' ? 'Not checked' : claim.support.replace(/_/g, ' ');
  const isQuoted = claim.attribution !== 'authorial';
  const kind = claim.kind ? claim.kind.replace(/_/g, ' ') : '';
  return `
    <li class="ml-claim">
      <div class="ml-observation-head">
        ${chip(supportLabel)}
        ${isQuoted ? chip('Quoted', { 'data-attribution': 'quoted' }) : ''}
        ${kind ? chip(kind) : ''}
      </div>
      <p class="ml-observation-quote">${escapeHtml(claim.text)}</p>
    </li>
  `;
}

function renderAbstention(abstention) {
  return `<li class="ml-abstention">${escapeHtml(abstention.message)}</li>`;
}

function statRow(label, value) {
  return `<div class="ml-coverage-stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderCoverageStats(coverage) {
  const stats = [];
  if (coverage.status) stats.push(['Coverage status', coverage.status.replace(/_/g, ' ')]);
  if (coverage.freshness_gate) {
    stats.push(['Freshness', coverage.freshness_gate.computed_status.replace(/_/g, ' ')]);
  }
  stats.push(['Coverage confidence', coverage.confidence]);
  stats.push(['Provenance', coverage.provenance.replace(/_/g, ' ')]);
  return stats.map(([label, value]) => statRow(label, value)).join('');
}

function renderCoverageOrigin(coverage) {
  const origin = coverage.story_origin;
  if (!origin) {
    return '<p class="ml-dimension-note">No story-origin record is available for this analysis.</p>';
  }
  const rows = [
    ['Original source', origin.original_source || 'Unknown'],
    ['First public', formatTimestamp(origin.first_public_at) || 'Unknown'],
    ['Same-story assessment', (origin.same_story_assessment || 'unknown').replace(/_/g, ' ')],
    ['Canonical coverage source', origin.canonical_coverage_source || NOT_RECORDED],
    [
      'Canonical-source basis',
      origin.canonical_coverage_basis ? String(origin.canonical_coverage_basis).replace(/_/g, ' ') : NOT_RECORDED
    ],
    ['Origin confidence', origin.confidence || NOT_RECORDED]
  ];
  const rationale = origin.rationale
    ? `<p class="ml-dimension-note">${escapeHtml(origin.rationale)}</p>`
    : '';
  return `<dl class="ml-coverage-grid">${rows.map(([l, v]) => statRow(l, v)).join('')}</dl>${rationale}`;
}

const COVERAGE_FRAMES_EMPTY_COPY = 'No coverage-frame comparison was available for this analysis.';
const COVERAGE_OBSERVATIONS_EMPTY_COPY = 'No coverage observations were recorded for this analysis.';
const ABSTENTION_EMPTY_COPY = 'No abstentions were recorded for this analysis.';
const SHARED_PRIVACY_LIMITS =
  'Full article text is not kept by Media Lens by default. Do not submit private messages, passwords, medical or financial records, information about children, paywalled content you are not authorized to fetch, or non-public/internal addresses. Live pasted-text analysis stays disabled — use Clarity for private messages.';
const SERVICE_CLAUSE =
  'Prepared public span text from that page may be sent to TypeSafe AI\u2019s Jev service under TypeSafe\u2019s own policy. TypeSafe does not fetch the URL.';
const OPERATOR_LIVE_URL_NOTICE = `Before you analyze: in operator-hosted live mode, the approved operator host requests the public page at the URL you enter. The destination site (and its CDN) may see the operator host\u2019s network address. ${SERVICE_CLAUSE} ${SHARED_PRIVACY_LIMITS}`;
const LOCAL_LIVE_URL_NOTICE = `Before you analyze: in local mode, the request may originate from your computer. The destination site (and its CDN) may see this computer\u2019s network address. ${SERVICE_CLAUSE} ${SHARED_PRIVACY_LIMITS}`;
const FIXTURE_PREVIEW_NOTICE = `Before you analyze: this fixture preview does not request the article URL. Neither your computer nor an operator host contacts the destination site. Prepared public spans are not sent to TypeSafe AI\u2019s Jev service. ${SHARED_PRIVACY_LIMITS}`;
const OPERATOR_CONSENT_NOTICE =
  'In operator-hosted live mode, the approved operator host may request the URL you entered. Prepared public spans may be sent to TypeSafe AI\u2019s Jev service. It will not score a person or outlet.';
const LOCAL_CONSENT_NOTICE =
  'In local mode, the request may originate from your computer. Prepared public spans may be sent to TypeSafe AI\u2019s Jev service. It will not score a person or outlet.';
const FIXTURE_PREVIEW_CONSENT_NOTICE =
  'This fixture preview does not request an article URL and does not send text to TypeSafe AI\u2019s Jev service. It will not score a person or outlet.';
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u2028\u2029]/;
const ENCODED_ASCII_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const INSUFFICIENT_ABSTENTION_REASONS = new Set(['insufficient_text', 'low_confidence', 'no_provenance', 'no_timestamp']);
const ABSTAIN_REASONS = new Set([
  'engine_disabled',
  'engine_unavailable',
  'engine_failure',
  'model_mismatch',
  'paywall',
  'unsupported_language',
  'oversized_input',
  'prompt_injection_suspected'
]);

function countPhrase(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function containsControlEncoding(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (CONTROL_CHARS.test(current) || ENCODED_ASCII_CONTROL.test(current)) return true;
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return false;
    current = decoded;
  }
  return CONTROL_CHARS.test(current) || ENCODED_ASCII_CONTROL.test(current);
}

function liveUrlDisclosure(mode = 'operator') {
  if (mode === 'local') return LOCAL_LIVE_URL_NOTICE;
  if (mode === 'fixture-preview') return FIXTURE_PREVIEW_NOTICE;
  return OPERATOR_LIVE_URL_NOTICE;
}

function consentDisclosure(mode = 'operator') {
  if (mode === 'local') return LOCAL_CONSENT_NOTICE;
  if (mode === 'fixture-preview') return FIXTURE_PREVIEW_CONSENT_NOTICE;
  return OPERATOR_CONSENT_NOTICE;
}

function disclosureMode() {
  if (IS_FIXTURE_PREVIEW) return 'fixture-preview';
  if (IS_LOCAL_PREVIEW) return 'local';
  return 'operator';
}

function applyDisclosure() {
  const notice = byId('ml-live-url-notice');
  if (notice) notice.textContent = liveUrlDisclosure(disclosureMode());
  const consent = byId('consent-fetch-notice');
  if (consent) consent.textContent = consentDisclosure(disclosureMode());
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  if (containsControlEncoding(value) || containsControlEncoding(trimmed)) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  if (
    containsControlEncoding(url.href) ||
    containsControlEncoding(url.hostname) ||
    containsControlEncoding(url.pathname) ||
    containsControlEncoding(url.search) ||
    containsControlEncoding(url.hash)
  ) {
    return null;
  }
  return url;
}

function looksLikeUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('://');
}

function clusterMemberLabel(member, url) {
  const source = typeof member?.source === 'string' ? member.source.trim() : '';
  if (source && !looksLikeUrl(source)) return source;
  if (url) return url.hostname;
  if (source) return source;
  return 'Unknown source';
}

function renderClusterMember(member) {
  const relation = String(member?.relation || 'unknown').replace(/_/g, ' ');
  const safe = safeHttpsUrl(member?.url);
  const label = escapeHtml(clusterMemberLabel(member, safe));
  const relationText = escapeHtml(relation);
  if (!safe) {
    return `<li class="ml-cluster-item"><strong>${label}</strong> · ${relationText}</li>`;
  }
  return `<li class="ml-cluster-item"><a class="ml-cluster-link" href="${escapeHtml(safe.href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a> · ${relationText}</li>`;
}

function renderClusterMembers(coverage) {
  const members = coverage?.cluster?.members;
  if (!Array.isArray(members) || members.length === 0) return '';
  return members.map((member) => renderClusterMember(member)).join('');
}

function renderCoverageFrames(coverage) {
  const frames = coverage && Array.isArray(coverage.frames) ? coverage.frames : [];
  if (frames.length === 0) return COVERAGE_FRAMES_EMPTY_COPY;
  if (frames.length === 1) return '1 coverage-frame record is included in this result.';
  return `${frames.length} coverage-frame records are included in this result.`;
}

function renderCoverageObservationList(graph) {
  const observations = Array.isArray(graph?.observations) ? graph.observations : [];
  const coverageObservations = observations.filter((obs) => obs && obs.dimension === 'coverage');
  if (coverageObservations.length === 0) {
    return `<li class="ml-empty-state">${escapeHtml(COVERAGE_OBSERVATIONS_EMPTY_COPY)}</li>`;
  }
  return coverageObservations.map((obs) => renderObservation(graph, obs)).join('');
}

function renderAbstentionList(graph) {
  const items = Array.isArray(graph?.abstentions) ? graph.abstentions.filter(Boolean) : [];
  if (items.length === 0) {
    return `<li class="ml-empty-state">${escapeHtml(ABSTENTION_EMPTY_COPY)}</li>`;
  }
  return items.map((item) => renderAbstention(item)).join('');
}

function abstentionsFor(graph, target) {
  const abstentions = Array.isArray(graph?.abstentions) ? graph.abstentions : [];
  return abstentions.filter((item) => item && item.scope === 'dimension' && item.target === target);
}

function graphAbstentions(graph) {
  const abstentions = Array.isArray(graph?.abstentions) ? graph.abstentions : [];
  return abstentions.filter((item) => item && item.scope === 'graph');
}

function stateFromAbstentions(items) {
  const reasons = items.map((item) => item.reason).filter((reason) => typeof reason === 'string');
  if (reasons.some((reason) => INSUFFICIENT_ABSTENTION_REASONS.has(reason))) {
    return { state: 'Insufficient evidence', detail: countPhrase(items.length, 'abstention') };
  }
  if (reasons.some((reason) => ABSTAIN_REASONS.has(reason)) || items.length > 0) {
    return { state: 'Abstained', detail: items.length ? countPhrase(items.length, 'abstention') : '' };
  }
  return null;
}

function languageOverview(graph) {
  const item = { label: 'Language', href: '#ml-language-heading' };
  if (!Array.isArray(graph?.observations)) return { ...item, state: 'Not available', detail: '' };
  const language = graph.observations.filter((obs) => obs && obs.dimension === 'language');
  const observed = language.filter((obs) => obs.strength === 'observed').length;
  const possible = language.filter((obs) => obs.strength === 'candidate').length;
  if (observed > 0) {
    const parts = [countPhrase(observed, 'observed', 'observed')];
    if (possible > 0) parts.push(countPhrase(possible, 'possible', 'possible'));
    return { ...item, state: 'Observed', detail: parts.join(' · ') };
  }
  if (possible > 0) return { ...item, state: 'Possible', detail: countPhrase(possible, 'possible', 'possible') };
  const blockingGraph = graphAbstentions(graph).filter((entry) =>
    ['insufficient_text', 'oversized_input', 'unsupported_language', 'paywall', 'engine_disabled', 'engine_unavailable'].includes(entry.reason)
  );
  const fromAbstention = stateFromAbstentions([...abstentionsFor(graph, 'language'), ...blockingGraph]);
  if (fromAbstention) return { ...item, ...fromAbstention };
  return { ...item, state: 'Not observed', detail: 'No language observations' };
}

function claimsOverview(graph) {
  const item = { label: 'Claims', href: '#ml-claims-heading' };
  if (!Array.isArray(graph?.claims)) return { ...item, state: 'Not available', detail: '' };
  if (graph.claims.length === 0) {
    const blockingGraph = graphAbstentions(graph).filter((entry) => entry.reason === 'insufficient_text');
    const fromAbstention = stateFromAbstentions([...abstentionsFor(graph, 'claims'), ...blockingGraph]);
    if (fromAbstention) return { ...item, ...fromAbstention };
    return { ...item, state: 'Not observed', detail: 'No claims' };
  }
  const counts = { supported: 0, contradicted: 0, mixed: 0, unclear: 0, not_checked: 0 };
  for (const claim of graph.claims) {
    if (claim && Object.prototype.hasOwnProperty.call(counts, claim.support)) counts[claim.support] += 1;
  }
  const total = graph.claims.length;
  if (counts.not_checked === total) {
    return { ...item, state: 'Not available', detail: `${countPhrase(total, 'claim')} · support not checked` };
  }
  const parts = [];
  if (counts.supported) parts.push(`${counts.supported} supported`);
  if (counts.contradicted) parts.push(`${counts.contradicted} contradicted`);
  if (counts.mixed) parts.push(`${counts.mixed} mixed`);
  if (counts.unclear) parts.push(`${counts.unclear} unclear`);
  if (counts.not_checked) parts.push(`${counts.not_checked} not checked`);
  if (counts.supported > 0) return { ...item, state: 'Observed', detail: parts.join(' · ') };
  if (counts.unclear > 0 || counts.mixed > 0) return { ...item, state: 'Insufficient evidence', detail: parts.join(' · ') };
  if (counts.contradicted > 0) {
    const detail = parts.length === 1 ? `${countPhrase(counts.contradicted, 'claim')} · support contradicted` : parts.join(' · ');
    return { ...item, state: 'Not observed', detail };
  }
  return { ...item, state: 'Not available', detail: countPhrase(total, 'claim') };
}

function coverageOverview(graph) {
  const item = { label: 'Coverage', href: '#ml-coverage-heading' };
  const coverage = graph?.coverage;
  if (!coverage || typeof coverage !== 'object') return { ...item, state: 'Not available', detail: '' };
  if (coverage.status === 'not_requested') return { ...item, state: 'Not available', detail: '' };
  if (coverage.status === 'insufficient') {
    const fromAbstention = stateFromAbstentions(abstentionsFor(graph, 'coverage'));
    return { ...item, state: 'Insufficient evidence', detail: fromAbstention?.detail || '' };
  }
  if (coverage.status !== 'available') return { ...item, state: 'Not available', detail: '' };
  const parts = [];
  const cluster = coverage.cluster;
  if (cluster && Number.isFinite(cluster.independent_sources_estimate)) {
    parts.push(countPhrase(cluster.independent_sources_estimate, 'independent source'));
  }
  if (cluster && Number.isFinite(cluster.duplicate_or_syndicated_count)) {
    parts.push(countPhrase(cluster.duplicate_or_syndicated_count, 'duplicate or syndicated', 'duplicate or syndicated'));
  }
  if (coverage.freshness_gate && typeof coverage.freshness_gate.computed_status === 'string') {
    parts.push(`freshness ${coverage.freshness_gate.computed_status.replace(/_/g, ' ')}`);
  }
  return { ...item, state: 'Observed', detail: parts.join(' · ') };
}

function sourceContextOverview(graph) {
  const item = { label: 'Source context', href: '#ml-source-context-heading' };
  const source = graph?.source_context;
  if (!source || typeof source !== 'object') return { ...item, state: 'Not available', detail: '' };
  const domain = [source.canonical_domain, source.publisher?.name, source.publisher?.domain].find(
    (value) => typeof value === 'string' && value.trim()
  );
  if (domain) return { ...item, state: 'Observed', detail: `Metadata only · ${domain.trim()}` };
  const flags = [];
  if (source.metadata?.has_byline === true) flags.push('byline');
  if (source.metadata?.has_published_time === true) flags.push('published time');
  if (source.metadata?.has_canonical === true) flags.push('canonical link');
  if (flags.length) return { ...item, state: 'Observed', detail: `Metadata only · ${flags.join(', ')}` };
  return { ...item, state: 'Not observed', detail: 'No source identifiers' };
}

function buildAnalysisOverview(graph) {
  return [languageOverview(graph), claimsOverview(graph), coverageOverview(graph), sourceContextOverview(graph)].filter(
    (item) => item && item.state
  );
}

function renderAnalysisOverview(graph) {
  return buildAnalysisOverview(graph)
    .map(
      (item) => `<li>
      <a class="ml-overview-link" href="${escapeHtml(item.href)}">
        <span class="ml-overview-dimension">${escapeHtml(item.label)}</span>
        <span class="ml-chip" data-overview-state="${escapeHtml(item.state)}">${escapeHtml(item.state)}</span>
        ${item.detail ? `<span class="ml-overview-detail">${escapeHtml(item.detail)}</span>` : ''}
      </a>
    </li>`
    )
    .join('');
}

function renderSourceContextStats(sourceContext) {
  const stats = [
    ['Domain', sourceContext.canonical_domain || 'Unknown'],
    ['Publisher', sourceContext.publisher?.name || sourceContext.publisher?.domain || 'Unknown'],
    ['Has byline', sourceContext.metadata.has_byline ? 'Yes' : 'No'],
    ['Has published time', sourceContext.metadata.has_published_time ? 'Yes' : 'No'],
    ['Has canonical link', sourceContext.metadata.has_canonical ? 'Yes' : 'No']
  ];
  return stats.map(([label, value]) => statRow(label, value)).join('');
}

function renderEngineStats(graph) {
  const jev = graph.engine?.jev || {};
  const privacy = graph.privacy || {};
  const stats = [
    ['Pipeline', graph.engine?.pipeline_version || 'Unknown'],
    ['Jev mode', jev.mode || 'Unknown'],
    ['Jev model requested', jev.model_requested || 'Unknown'],
    ['Question set', jev.question_set || 'Unknown'],
    ['Newsjack mode', graph.engine?.newsjack?.mode || 'Unknown'],
    ['Full text persisted', privacy.full_text_persisted === false ? 'No' : 'Unknown'],
    ['Retention', privacy.retention || 'Unknown']
  ];
  return stats.map(([label, value]) => statRow(label, value)).join('');
}

function formatTimestamp(value, precision) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (precision === 'none') return 'Unknown';
  const iso = date.toISOString();
  if (precision === 'date') return iso.slice(0, 10);
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatArtifactMeta(artifact) {
  const parts = [];
  if (artifact.byline) parts.push(artifact.byline);
  if (artifact.publisher?.domain) parts.push(artifact.publisher.domain);
  if (artifact.published_at) parts.push(formatTimestamp(artifact.published_at, artifact.timestamp_precision));
  if (artifact.paywall_detected) parts.push('Paywall detected');
  if (artifact.kind) parts.push(artifact.kind.replace(/_/g, ' '));
  return parts.join(' · ');
}

function isFixtureResult(graph) {
  return graph?.artifact?.input_mode === 'fixture' || graph?.coverage?.provenance === 'fixture';
}

function recordedOpening(graph) {
  const spans = Array.isArray(graph?.spans) ? graph.spans : [];
  const lede = spans.find((span) => span && span.role === 'authorial' && span.text) || spans.find((span) => span && span.role === 'headline' && span.text);
  return lede ? String(lede.text) : '';
}

function storyOverviewCopy(graph) {
  const opening = recordedOpening(graph);
  const prefix = isFixtureResult(graph) ? 'Fixture example. ' : '';
  if (!opening) return `${prefix}No opening text was recorded for this item.`;
  return `${prefix}Recorded opening: ${opening}`;
}

function storySearchText(story) {
  return [story?.title, story?.id, story?.domain, story?.byline, story?.fixtureNote, ...(story?.topics || [])]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .toLowerCase();
}

function filterFixtureStories(query, stories = FIXTURE_STORIES) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(stories) ? stories : [];
  if (!q) return list.slice();
  return list.filter((story) => storySearchText(story).includes(q));
}

function storiesForLane(laneId, stories = FIXTURE_STORIES) {
  const list = Array.isArray(stories) ? stories : [];
  if (!laneId || laneId === 'all') return list.slice();
  return list.filter((story) => story && story.lane === laneId);
}

function renderCoverageCountIndicator(summary) {
  if (!summary || !Number.isFinite(summary.members)) {
    return '<p class="ml-gap-note">Coverage gap in this fixture: no recorded coverage count. That is not proof a fact was left out.</p>';
  }
  const independent = Number(summary.independent) || 0;
  const syndicated = Number(summary.syndicated) || 0;
  const frames = Number(summary.frames) || 0;
  const frameLine = frames > 0 ? `${frames} represented frame records` : 'No represented frames recorded';
  const parts = [];
  if (independent > 0) parts.push(`<span class="ml-count-independent" style="flex-grow:${independent}"></span>`);
  if (syndicated > 0) parts.push(`<span class="ml-count-syndicated" style="flex-grow:${syndicated}"></span>`);
  const meter = parts.length ? `<div class="ml-count-meter" aria-hidden="true">${parts.join('')}</div>` : '';
  return `<p class="ml-coverage-count">Recorded coverage count: ${summary.members} cluster ${
    summary.members === 1 ? 'member' : 'members'
  }. Independent reporting ${independent}. Syndicated or duplicate ${syndicated}. ${frameLine}.</p>${meter}<p class="ml-form-note">Fixture count only. Not a live census.</p>`;
}

function fixtureGraphUrl(id) {
  if (typeof id !== 'string' || !FIXTURE_GRAPH_ID.test(id)) return null;
  if (!FIXTURE_STORIES.some((story) => story.id === id)) return null;
  return `./fixtures/expected/${id}.graph.json`;
}

function storyIdFromHash() {
  if (typeof window === 'undefined') return null;
  const match = /^#story=(synthetic-\d{2}-[a-z0-9-]+)$/.exec(window.location.hash || '');
  return match ? match[1] : null;
}

function renderStoryCard(story) {
  const gap = !story.coverageCount;
  return `<li class="ml-story-card${gap ? ' ml-gap-card' : ''}">
    <p class="ml-sample-kicker">${gap ? 'Coverage gap' : 'Fixture story'}</p>
    <h3>${escapeHtml(story.title)}</h3>
    <p>${escapeHtml(story.domain)} · <code>${escapeHtml(story.id)}</code></p>
    <p>${escapeHtml(story.fixtureNote)}</p>
    ${renderCoverageCountIndicator(story.coverageCount)}
    <button class="button button-secondary" type="button" data-fixture-id="${escapeHtml(story.id)}">Open fixture workspace</button>
  </li>`;
}

function renderFixtureLanes() {
  const host = byId('fixture-lanes');
  if (!host) return;
  host.innerHTML = FIXTURE_LANES.map(
    (lane) =>
      `<button class="ml-lane" type="button" data-lane="${escapeHtml(lane.id)}" aria-pressed="${
        lane.id === activeLane ? 'true' : 'false'
      }">${escapeHtml(lane.label)}</button>`
  ).join('');
}

function renderStoryCatalog(query) {
  const stories = filterFixtureStories(query, storiesForLane(activeLane));
  const list = byId('story-results');
  const status = byId('story-search-status');
  if (!list) return;
  const laneLabel = FIXTURE_LANES.find((lane) => lane.id === activeLane)?.label || 'All fixtures';
  if (stories.length === 0) {
    list.innerHTML = '';
    if (status) status.textContent = `No fixture story matches that search in ${laneLabel}.`;
    return;
  }
  list.innerHTML = stories.map((story) => renderStoryCard(story)).join('');
  if (status) {
    const q = String(query || '').trim();
    const noun = stories.length === 1 ? 'fixture story' : 'fixture stories';
    status.textContent = q
      ? `${stories.length} ${noun} match in ${laneLabel}. These are examples, not live coverage.`
      : `${stories.length} ${noun} in ${laneLabel}. These are examples, not live coverage.`;
  }
}

function renderRetrievalMetadata(graph) {
  const artifact = graph?.artifact || {};
  const coverage = graph?.coverage || {};
  const engine = graph?.engine || {};
  const url = safeHttpsUrl(artifact.url);
  const rows = [
    ['Input', artifact.input_mode || NOT_RECORDED],
    ['Provenance', coverage.provenance ? String(coverage.provenance).replace(/_/g, ' ') : NOT_RECORDED],
    ['Publisher domain', artifact.publisher?.domain || NOT_RECORDED],
    ['Published', formatTimestamp(artifact.published_at, artifact.timestamp_precision) || NOT_RECORDED],
    ['Timestamp precision', artifact.timestamp_precision || NOT_RECORDED],
    ['Newsjack mode', engine.newsjack?.mode || NOT_RECORDED],
    ['Generated', formatTimestamp(graph?.generated_at, 'time') || NOT_RECORDED]
  ];
  const link = url
    ? `<p class="ml-dimension-note">Recorded URL: <a class="ml-cluster-link" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url.hostname)}</a></p>`
    : `<p class="ml-dimension-note">Recorded URL: ${artifact.url ? 'Not shown. The stored value is not a safe https URL.' : NOT_RECORDED}</p>`;
  const fixtureNote = isFixtureResult(graph)
    ? '<p class="ml-dimension-note">Retrieval fields describe this fixture record. They are not a live fetch.</p>'
    : '';
  return `<dl class="ml-coverage-grid">${rows.map(([label, value]) => statRow(label, value)).join('')}</dl>${link}${fixtureNote}`;
}

function renderReportingSplit(coverage) {
  const cluster = coverage?.cluster;
  if (!cluster || !Number.isFinite(cluster.independent_sources_estimate) || !Number.isFinite(cluster.duplicate_or_syndicated_count)) {
    return '<p class="ml-empty-state">Independent and syndicated counts were not recorded for this result.</p>';
  }
  return `<dl class="ml-coverage-grid">${statRow('Independent reporting', String(cluster.independent_sources_estimate))}${statRow(
    'Syndicated or duplicate repetition',
    String(cluster.duplicate_or_syndicated_count)
  )}</dl><p class="ml-dimension-note">These estimates come from the recorded cluster. The distribution below counts each member relation as stored. A same-story member can still sit in the duplicate estimate when the record marks it as wire copy. Syndicated repetition is not an independent report.</p>`;
}

function renderCoverageDistribution(coverage) {
  const members = coverage?.cluster?.members;
  if (!Array.isArray(members) || members.length === 0) {
    return '<p class="ml-empty-state">No coverage distribution was recorded for this result.</p>';
  }
  const counts = new Map();
  for (const member of members) {
    const relation = typeof member?.relation === 'string' && member.relation ? member.relation : 'unclear';
    counts.set(relation, (counts.get(relation) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([relation, count]) => statRow(RELATION_LABELS[relation] || relation.replace(/_/g, ' '), String(count)))
    .join('');
  const bar = [...counts.entries()]
    .map(([, count]) => `<span style="flex-grow:${Number(count)}"></span>`)
    .join('');
  const note =
    coverage?.provenance === 'fixture'
      ? 'Fixture distribution of recorded cluster relations. Not a live census and not a political bias chart.'
      : 'Relation mix in the recorded cluster. Not a political bias chart.';
  const total = members.length;
  const frames = Array.isArray(coverage?.frames) ? coverage.frames.length : 0;
  const independent = coverage?.cluster?.independent_sources_estimate;
  const syndicated = coverage?.cluster?.duplicate_or_syndicated_count;
  const concentration =
    Number.isFinite(independent) && Number.isFinite(syndicated)
      ? `<p class="ml-dimension-note">Independent-source concentration: ${independent} independent reporting, ${syndicated} syndicated or duplicate. Represented frames recorded: ${frames}.</p>`
      : '';
  return `<p class="ml-dimension-note">${escapeHtml(note)}</p><dl class="ml-coverage-grid">${rows}</dl><div class="ml-distribution" aria-hidden="true">${bar}</div><p class="ml-dimension-note">${total} recorded cluster ${
    total === 1 ? 'member' : 'members'
  }.</p>${concentration}`;
}

function renderCoverageGap(coverage) {
  const members = coverage?.cluster?.members;
  const hasMembers = Array.isArray(members) && members.length > 0;
  if (hasMembers && coverage?.status === 'available') return '';
  let reason = 'No related-source cluster was recorded.';
  if (coverage?.status === 'not_requested') reason = 'Coverage was not requested for this record.';
  else if (coverage?.status === 'insufficient') reason = 'Coverage evidence in this record is insufficient.';
  return `<article class="ml-gap-card"><h3>Coverage gap</h3><p>${escapeHtml(reason)} This describes an absence in the record. It is not proof a fact was left out.</p></article>`;
}

function membersForCompare(coverage, mode) {
  const members = Array.isArray(coverage?.cluster?.members) ? coverage.cluster.members : [];
  if (mode === 'frames') return [];
  if (mode === 'syndicated') return members.filter((member) => member?.relation === 'syndicated');
  if (mode === 'same_story') return members.filter((member) => member?.relation === 'same_story');
  if (mode === 'independent') {
    return members.filter((member) => member?.relation === 'surfaced' || member?.relation === 'same_story');
  }
  return members.slice();
}

function graphTimestampCopy(graph) {
  const stamp = formatTimestamp(graph?.generated_at, 'time');
  if (!stamp) return 'Graph timestamp: Not recorded.';
  if (isFixtureResult(graph)) return `Fixture graph timestamp: ${stamp}. Not a live update.`;
  return `Graph timestamp: ${stamp}.`;
}

function applyCompare(graph) {
  const coverage = graph?.coverage;
  document.querySelectorAll('[data-compare]').forEach((button) => {
    button.setAttribute('aria-pressed', button.getAttribute('data-compare') === compareMode ? 'true' : 'false');
  });
  const status = byId('compare-status');
  const list = byId('coverage-cluster');
  if (!list) return;
  if (compareMode === 'frames') {
    const frames = renderFrameList(coverage);
    list.innerHTML = frames || '<li class="ml-empty-state">No represented frames were recorded for this result.</li>';
    if (status) {
      status.textContent = frames
        ? 'Showing represented frames recorded with this result.'
        : 'No represented frames were recorded, so this comparison list is empty.';
    }
    return;
  }
  const members = membersForCompare(coverage, compareMode);
  const total = Array.isArray(coverage?.cluster?.members) ? coverage.cluster.members.length : 0;
  const html = members.map((member) => renderClusterMember(member)).join('');
  list.innerHTML = html || '<li class="ml-empty-state">No recorded sources match this comparison.</li>';
  if (status) {
    const wireNote =
      compareMode === 'independent'
        ? ' Surfaced and same-story relations are listed. The independent estimate can still be lower when a same-story member is wire copy.'
        : '';
    status.textContent = `Showing ${members.length} of ${total} recorded cluster members.${wireNote} Fixture comparison only.`;
  }
}

function renderFrameList(coverage) {
  const frames = Array.isArray(coverage?.frames) ? coverage.frames : [];
  if (frames.length === 0) return '';
  return `<ul class="ml-cluster-list">${frames
    .map((frame) => {
      const label = typeof frame?.label === 'string' && frame.label.trim() ? frame.label.trim() : 'Unlabeled frame';
      const count = Array.isArray(frame?.member_urls) ? frame.member_urls.length : 0;
      const basis = typeof frame?.basis === 'string' && frame.basis ? frame.basis.replace(/_/g, ' ') : NOT_RECORDED;
      return `<li class="ml-cluster-item"><strong>${escapeHtml(label)}</strong> · ${count} recorded member ${
        count === 1 ? 'URL' : 'URLs'
      } · basis ${escapeHtml(basis)}</li>`;
    })
    .join('')}</ul>`;
}

function omissionCandidates(graph) {
  const observations = Array.isArray(graph?.observations) ? graph.observations : [];
  return observations.filter((obs) => obs && (obs.signal === 'selective_context_candidate' || obs.dimension === 'coverage'));
}

function renderOmissionCandidates(graph) {
  const items = omissionCandidates(graph);
  if (items.length === 0) return `<li class="ml-empty-state">${escapeHtml(OMISSION_EMPTY_COPY)}</li>`;
  return items.map((obs) => renderObservation(graph, obs)).join('');
}

function renderInfluenceProfile(graph) {
  return buildAnalysisOverview(graph)
    .map(
      (item) =>
        `<div class="ml-coverage-stat"><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.state)}${
          item.detail ? ` · ${escapeHtml(item.detail)}` : ''
        }</dd></div>`
    )
    .join('');
}

function renderGraph(graph, source = 'analysis') {
  currentGraph = graph;

  const languageObservations = graph.observations.filter((o) => o.dimension === 'language');
  const artifact = graph.artifact || {};
  const fixture = isFixtureResult(graph);

  byId('result-kicker').textContent = fixture ? 'Fixture story workspace' : 'Story workspace';
  const badge = byId('result-fixture-badge');
  if (badge) {
    badge.hidden = !fixture;
    badge.textContent = fixture ? 'Fixture example. Not live coverage.' : '';
  }
  byId('result-title').textContent = artifact.title || 'Untitled public article';
  byId('result-overview').textContent = storyOverviewCopy(graph);
  byId('result-meta').textContent = formatArtifactMeta(artifact);
  const updated = byId('result-updated');
  if (updated) updated.textContent = graphTimestampCopy(graph);
  const questionNote = byId('question-reading-note');
  if (questionNote) questionNote.hidden = true;
  const questionDestination = byId('question-reading-destination');
  if (questionDestination) questionDestination.hidden = true;
  byId('result-limits').textContent = fixture
    ? 'Fixture example. Evidence is inspectable. This is not live coverage, not a truth detector, and not a person or outlet score.'
    : 'Experimental Jev-only preview. Evidence is inspectable. This is not a truth detector and not a person or outlet score.';
  byId('overview-list').innerHTML = renderAnalysisOverview(graph);
  byId('retrieval-metadata').innerHTML = renderRetrievalMetadata(graph);

  byId('language-list').innerHTML =
    languageObservations.map((o) => renderObservation(graph, o)).join('') ||
    '<li class="ml-empty-state">No language signals reached the reporting threshold for this text.</li>';

  byId('claims-list').innerHTML =
    graph.claims.map((c) => renderClaim(graph, c)).join('') || '<li class="ml-empty-state">No checkable-looking claims were found.</li>';

  byId('coverage-stats').innerHTML = renderCoverageStats(graph.coverage);
  byId('coverage-freshness-rationale').textContent = graph.coverage.freshness_gate?.rationale || '';
  byId('coverage-origin').innerHTML = renderCoverageOrigin(graph.coverage);
  compareMode = 'all';
  applyCompare(graph);
  byId('reporting-split').innerHTML = renderReportingSplit(graph.coverage);
  byId('coverage-distribution').innerHTML = renderCoverageDistribution(graph.coverage);
  byId('coverage-frames').textContent = renderCoverageFrames(graph.coverage);
  byId('coverage-frame-list').innerHTML = renderFrameList(graph.coverage);
  const gapHost = byId('coverage-gap');
  if (gapHost) gapHost.innerHTML = renderCoverageGap(graph.coverage);
  byId('omission-list').innerHTML = renderOmissionCandidates(graph);
  byId('coverage-list').innerHTML = renderCoverageObservationList(graph);

  byId('source-context-stats').innerHTML = renderSourceContextStats(graph.source_context);
  byId('source-context-note').textContent = graph.source_context?.note || '';
  byId('influence-profile-list').innerHTML = renderInfluenceProfile(graph);

  byId('abstention-list').innerHTML = renderAbstentionList(graph);
  byId('alternative-readings').textContent = ALTERNATIVE_READINGS_EMPTY;
  byId('engine-stats').innerHTML = renderEngineStats(graph);

  showView('results');
  byId('results')?.focus();

  if (source === 'fixture-file') {
    announceStatus('Fixture story opened. This is an in-repo example, not live coverage.');
    return;
  }
  announceStatus(
    `Analysis complete: ${languageObservations.length} language observation${languageObservations.length === 1 ? '' : 's'}, ${graph.claims.length} claim${graph.claims.length === 1 ? '' : 's'} found.`
  );
}

function announceStatus(message) {
  byId('analyze-status-live').textContent = message;
}

function evidenceOnlySpanIds(graph) {
  const ids = new Set();
  for (const obs of graph.observations) for (const id of obs.span_ids) ids.add(id);
  for (const claim of graph.claims) for (const id of claim.span_ids) ids.add(id);
  return ids;
}

/**
 * Client-side mirror of worker/graph.js#toEvidenceOnlyExport: only spans
 * referenced by a shown observation or claim keep their text. Used only
 * when the user explicitly chooses to export; nothing is written to disk
 * or storage automatically.
 */
function toEvidenceOnlyExport(graph) {
  const keepIds = evidenceOnlySpanIds(graph);
  const spans = graph.spans.map((span) => (keepIds.has(span.id) ? { ...span } : { ...span, text: '' }));
  return { ...graph, spans, privacy: { ...graph.privacy, spans_included: 'evidence_only' } };
}

function downloadJson(filenamePrefix, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}-${data.graph_id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showView(view) {
  const landing = byId('landing-view');
  const loading = byId('loading-panel');
  const results = byId('results');
  const errorActions = byId('error-actions');
  landing.hidden = view !== 'landing';
  loading.hidden = view !== 'loading';
  results.hidden = view !== 'results';
  if (view !== 'error') {
    errorActions.hidden = true;
  }
  if (view === 'results') {
    results.hidden = false;
    landing.hidden = true;
    loading.hidden = true;
  }
}

function showError(message) {
  const el = byId('analyze-error');
  el.hidden = false;
  el.textContent = message;
  byId('error-actions').hidden = false;
  announceStatus(message);
  byId('analyze-error')?.focus();
}

function clearError() {
  byId('analyze-error').hidden = true;
  byId('error-actions').hidden = true;
  byId('article-url').setAttribute('aria-invalid', 'false');
}

function setUrlError(message) {
  byId('article-url').setAttribute('aria-invalid', 'true');
  byId('article-url').setAttribute('aria-describedby', 'article-url-help analyze-error');
  showError(message);
}

function apiErrorMessage(body, status) {
  switch (body?.error) {
    case 'live_url_not_allowlisted':
      return 'This source is not currently approved for live analysis. Try an approved public URL.';
    case 'oversized_input':
    case 'TOO_LARGE':
      return OVERSIZED_INPUT_MESSAGE;
    case 'live_killed':
      return 'Live analysis is temporarily paused by the operator. No analysis was run.';
    case 'live_url_disabled':
      return 'Live URL analysis is temporarily unavailable. No analysis was run.';
    case 'rate_limited':
      return body.message || 'The service is busy. Wait a minute and try again.';
    case 'TIMEOUT':
    case 'timeout':
    case 'FETCH_ERROR':
      return 'The article could not be fetched in time. No analysis was run. You can retry.';
    case 'BLOCKED_HOST':
    case 'BAD_SCHEME':
    case 'BAD_URL':
      return 'This URL is not allowed. Use a public https:// address from an approved host.';
    case 'consent_required':
      return 'Confirm public-material consent before analyzing.';
    case 'live_pasted_text_disabled':
      return 'Live pasted-text analysis stays disabled. Use Clarity for private messages, or a fixture example locally.';
    case 'internal_error':
      return 'The Media Lens service could not complete this analysis. No partial result was shown. You can retry.';
    default:
      return body?.message || `The Media Lens service returned an error (${status}).`;
  }
}

function closeConsentDialog() {
  const dialog = byId('consent-dialog');
  if (dialog.open) dialog.close();
}

function openConsentDialog() {
  const dialog = byId('consent-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  byId('consent-checkbox').focus();
}

function buildPayload() {
  const mode = currentMode();
  const payload = { user_asserted_public: true, mode, consent_at: consentCheckedAt };

  if (mode === 'fixture') {
    payload.fixture_id = byId('fixture-select').value;
    return { payload };
  }
  if (mode === 'pasted_text') {
    payload.text = byId('pasted-text').value;
    payload.kind = 'other_public';
    return { payload };
  }

  const url = byId('article-url').value.trim();
  if (!url) return { error: 'Enter an approved public URL.', urlError: true };
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { error: 'Enter a complete https:// URL.', urlError: true };
  }
  if (parsedUrl.protocol !== 'https:') {
    return { error: 'Use an https:// public URL.', urlError: true };
  }
  if (IS_FIXTURE_PREVIEW) {
    return { error: 'Live URL analysis is disabled in this fixture preview.' };
  }
  if (IS_LOCAL_PREVIEW) {
    return { error: 'Live URL analysis is available from the approved Media Lens host. Use a fixture example for local development.' };
  }
  if (!liveUrlReady) {
    return { error: 'Live URL analysis is temporarily unavailable. No analysis was run.' };
  }
  payload.url = url;
  payload.kind = 'article';
  return { payload };
}

function setLoadingStage(index) {
  const items = byId('loading-stages').querySelectorAll('li');
  items.forEach((item, i) => {
    item.dataset.active = i === index ? 'true' : 'false';
    item.dataset.done = i < index ? 'true' : 'false';
  });
  byId('loading-stage-text').textContent = LOADING_STAGES[index] || LOADING_STAGES[0];
  announceStatus(LOADING_STAGES[index] || LOADING_STAGES[0]);
}

function startLoadingStages() {
  stopLoadingStages();
  setLoadingStage(0);
  const started = Date.now();
  stageTimer = window.setInterval(() => {
    const elapsed = Date.now() - started;
    let index = 0;
    for (let i = 0; i < STAGE_DELAYS_MS.length; i += 1) {
      if (elapsed >= STAGE_DELAYS_MS[i]) index = i;
    }
    setLoadingStage(index);
  }, 400);
}

function stopLoadingStages() {
  if (stageTimer) {
    window.clearInterval(stageTimer);
    stageTimer = null;
  }
}

function clearStoryHash() {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#story=')) return;
  if (window.history && typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

async function loadFixtureGraph(id) {
  const url = fixtureGraphUrl(id);
  if (!url) {
    showError('That fixture story is not in the local catalog.');
    return;
  }
  clearError();
  announceStatus('Opening fixture example. No live coverage was requested.');
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error('fixture unavailable');
    const graph = await res.json();
    if (!graph || graph.schema !== 'influence-graph.v1') throw new Error('bad graph');
    if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
      const next = `#story=${id}`;
      if (window.location.hash !== next) window.history.replaceState(null, '', next);
    }
    renderGraph(graph, 'fixture-file');
  } catch {
    showError('This fixture example could not be opened. No live coverage was requested.');
  }
}

function setupStoryExplorer() {
  const form = byId('story-search-form');
  const query = byId('story-query');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      renderStoryCatalog(query ? query.value : '');
    });
  }
  if (query) query.addEventListener('input', () => renderStoryCatalog(query.value));
  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    const lane = el.closest('[data-lane]');
    if (lane && byId('fixture-lanes')?.contains(lane)) {
      activeLane = lane.getAttribute('data-lane') || 'all';
      renderFixtureLanes();
      renderStoryCatalog(query ? query.value : '');
      return;
    }
    const compare = el.closest('[data-compare]');
    if (compare && currentGraph) {
      compareMode = compare.getAttribute('data-compare') || 'all';
      applyCompare(currentGraph);
      return;
    }
    const target = el.closest('[data-fixture-id]');
    if (!target) return;
    const id = target.getAttribute('data-fixture-id');
    if (id) loadFixtureGraph(id);
  });
  const question = byId('question-reading');
  if (question) {
    question.addEventListener('click', () => {
      const note = byId('question-reading-note');
      if (note) note.hidden = false;
      const destination = byId('question-reading-destination');
      if (destination) destination.hidden = false;
      const limitations = byId('analysis-limitations');
      if (limitations) {
        limitations.tabIndex = -1;
        limitations.focus({ preventScroll: true });
        limitations.scrollIntoView({ block: 'start' });
      }
    });
  }
  renderFixtureLanes();
  renderStoryCatalog('');
  const initial = storyIdFromHash();
  if (initial) loadFixtureGraph(initial);
}

function goToLanding() {
  stopLoadingStages();
  if (analyzeAbort) analyzeAbort.abort();
  isSubmitting = false;
  clearStoryHash();
  showView('landing');
  clearError();
  updateSubmitEnabled();
  const returnFocus = byId('story-query') || byId('analyze-continue');
  returnFocus?.focus();
}

async function runAnalysis(payload) {
  clearError();
  closeConsentDialog();
  lastPayload = payload;
  isSubmitting = true;
  updateSubmitEnabled();
  showView('loading');
  byId('analyze-form').setAttribute('aria-busy', 'true');
  byId('loading-panel')?.focus();
  startLoadingStages();

  if (analyzeAbort) analyzeAbort.abort();
  analyzeAbort = new AbortController();

  try {
    const res = await fetch(`${WORKER_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: analyzeAbort.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showView('landing');
      showError(apiErrorMessage(body, res.status));
      return;
    }
    renderGraph(body);
  } catch (err) {
    showView('landing');
    if (err?.name === 'AbortError') {
      showError(CANCELLED_MESSAGE);
    } else {
      showError(
        IS_LOCAL_PREVIEW
          ? 'Could not reach the local worker. Confirm it is running and try again.'
          : 'Could not reach the Media Lens service. Try again later.'
      );
    }
  } finally {
    stopLoadingStages();
    isSubmitting = false;
    byId('analyze-form').removeAttribute('aria-busy');
    updateSubmitEnabled();
  }
}

function requestConsentThenAnalyze() {
  clearError();
  const built = buildPayload();
  if (built.error) {
    pendingPayload = null;
    if (built.urlError) setUrlError(built.error);
    else showError(built.error);
    return;
  }
  pendingPayload = built.payload;
  consentTrigger = document.activeElement;
  openConsentDialog();
}

async function handleSubmit(event) {
  event.preventDefault();
  const dialog = byId('consent-dialog');
  if (!dialog.open) {
    requestConsentThenAnalyze();
    return;
  }
  const consent = byId('consent-checkbox').checked;
  if (!consent) {
    showError('Check the consent box before analyzing.');
    return;
  }
  const built = pendingPayload ? { payload: pendingPayload } : buildPayload();
  if (built.error) {
    closeConsentDialog();
    if (built.urlError) setUrlError(built.error);
    else showError(built.error);
    return;
  }
  built.payload.consent_at = consentCheckedAt;
  built.payload.user_asserted_public = true;
  await runAnalysis(built.payload);
}

function setup() {
  setupInputModeToggle();
  setupStoryExplorer();
  byId('consent-checkbox').addEventListener('change', updateSubmitEnabled);
  byId('pasted-text').addEventListener('input', updateSubmitEnabled);
  byId('analyze-form').addEventListener('submit', handleSubmit);
  byId('analyze-continue').addEventListener('click', requestConsentThenAnalyze);
  byId('consent-cancel').addEventListener('click', () => closeConsentDialog());
  byId('consent-dialog').addEventListener('close', () => {
    pendingPayload = null;
    const trigger = consentTrigger;
    consentTrigger = null;
    if (!isSubmitting && trigger && typeof trigger.focus === 'function') trigger.focus();
  });
  byId('analyze-cancel').addEventListener('click', () => {
    if (analyzeAbort) analyzeAbort.abort();
  });
  byId('analyze-retry').addEventListener('click', () => {
    if (lastPayload) runAnalysis({ ...lastPayload, consent_at: consentCheckedAt });
    else requestConsentThenAnalyze();
  });
  byId('analyze-reset').addEventListener('click', goToLanding);
  byId('analyze-another').addEventListener('click', goToLanding);
  byId('sample-analyze').addEventListener('click', () => {
    const fixtureRadio = document.querySelector('input[name="input-mode"][value="fixture"]');
    fixtureRadio.checked = true;
    fixtureRadio.dispatchEvent(new Event('change', { bubbles: true }));
    byId('fixture-select').value = 'synthetic-01-quoted-vs-authorial';
    requestConsentThenAnalyze();
  });
  byId('export-json-btn').addEventListener('click', () => {
    if (!currentGraph) {
      showError('Run an analysis before exporting.');
      return;
    }
    downloadJson('influence-graph', toEvidenceOnlyExport(currentGraph));
  });
  byId('results').setAttribute('tabindex', '-1');
  byId('loading-panel').setAttribute('tabindex', '-1');
  applyDisclosure();
  checkHealth();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}

export {
  ALTERNATIVE_READINGS_EMPTY,
  COVERAGE_FRAMES_EMPTY_COPY,
  COVERAGE_OBSERVATIONS_EMPTY_COPY,
  ABSTENTION_EMPTY_COPY,
  FIXTURE_LANES,
  FIXTURE_STORIES,
  OMISSION_EMPTY_COPY,
  buildAnalysisOverview,
  consentDisclosure,
  filterFixtureStories,
  fixtureGraphUrl,
  liveUrlDisclosure,
  membersForCompare,
  observationDisplayLabel,
  omissionCandidates,
  renderAbstentionList,
  renderAnalysisOverview,
  renderClusterMember,
  renderClusterMembers,
  renderCoverageCountIndicator,
  renderCoverageDistribution,
  renderCoverageFrames,
  renderCoverageGap,
  renderCoverageObservationList,
  renderInfluenceProfile,
  renderObservation,
  renderOmissionCandidates,
  safeHttpsUrl,
  storiesForLane
};
