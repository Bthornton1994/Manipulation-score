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

let currentGraph = null;
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
    fixtureRadio.checked = true;
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
    statusEl.dataset.state = 'error';
    textEl.textContent = IS_LOCAL_PREVIEW
      ? 'No local worker found at 127.0.0.1:8787. Start it with: node media-lens/worker/server.js.'
      : 'The Media Lens service is unavailable. Try again later.';
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
  if (coverage.cluster) {
    stats.push(['Independent sources', String(coverage.cluster.independent_sources_estimate)]);
    stats.push(['Duplicate or syndicated', String(coverage.cluster.duplicate_or_syndicated_count)]);
  }
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
    ['Same-story assessment', (origin.same_story_assessment || 'unknown').replace(/_/g, ' ')]
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

function renderGraph(graph) {
  currentGraph = graph;

  const languageObservations = graph.observations.filter((o) => o.dimension === 'language');
  const artifact = graph.artifact || {};

  byId('result-title').textContent = artifact.title || 'Untitled public article';
  byId('result-meta').textContent = formatArtifactMeta(artifact);
  byId('overview-list').innerHTML = renderAnalysisOverview(graph);

  byId('language-list').innerHTML =
    languageObservations.map((o) => renderObservation(graph, o)).join('') ||
    '<li class="ml-empty-state">No language signals reached the reporting threshold for this text.</li>';

  byId('claims-list').innerHTML =
    graph.claims.map((c) => renderClaim(graph, c)).join('') || '<li class="ml-empty-state">No checkable-looking claims were found.</li>';

  byId('coverage-stats').innerHTML = renderCoverageStats(graph.coverage);
  byId('coverage-freshness-rationale').textContent = graph.coverage.freshness_gate?.rationale || '';
  byId('coverage-origin').innerHTML = renderCoverageOrigin(graph.coverage);
  byId('coverage-cluster').innerHTML = renderClusterMembers(graph.coverage);
  byId('coverage-frames').textContent = renderCoverageFrames(graph.coverage);
  byId('coverage-list').innerHTML = renderCoverageObservationList(graph);

  byId('source-context-stats').innerHTML = renderSourceContextStats(graph.source_context);
  byId('source-context-note').textContent = graph.source_context?.note || '';

  byId('abstention-list').innerHTML = renderAbstentionList(graph);
  byId('engine-stats').innerHTML = renderEngineStats(graph);

  showView('results');
  byId('results')?.focus();

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

function goToLanding() {
  stopLoadingStages();
  if (analyzeAbort) analyzeAbort.abort();
  isSubmitting = false;
  showView('landing');
  clearError();
  updateSubmitEnabled();
  byId('analyze-continue').focus();
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
  COVERAGE_FRAMES_EMPTY_COPY,
  COVERAGE_OBSERVATIONS_EMPTY_COPY,
  ABSTENTION_EMPTY_COPY,
  buildAnalysisOverview,
  consentDisclosure,
  liveUrlDisclosure,
  observationDisplayLabel,
  renderAbstentionList,
  renderAnalysisOverview,
  renderClusterMember,
  renderClusterMembers,
  renderCoverageFrames,
  renderCoverageObservationList,
  renderObservation,
  safeHttpsUrl
};
