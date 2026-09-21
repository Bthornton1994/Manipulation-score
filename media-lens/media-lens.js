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
let analyzeAbort = null;
let stageTimer = null;
let consentCheckedAt = null;

function isLocalPreviewPage() {
  return window.location.protocol === 'file:' || LOCAL_HOSTNAMES.has(window.location.hostname);
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
  const configured = document.querySelector('meta[name="media-lens-api-base"]')?.content?.trim();
  const configuredUrl = normalizeBaseUrl(configured);
  if (configuredUrl) return configuredUrl;
  if (isLocalPreviewPage()) return LOCAL_WORKER_BASE_URL;
  return window.location.origin;
}

const IS_LOCAL_PREVIEW = isLocalPreviewPage();
const WORKER_BASE_URL = resolveWorkerBaseUrl();

function byId(id) {
  return document.getElementById(id);
}

function updateUrlInputAvailability() {
  const articleUrl = byId('article-url');
  const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'url';
  if (articleUrl) articleUrl.disabled = mode !== 'url' || IS_LOCAL_PREVIEW || !liveUrlReady;
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

  if (!IS_LOCAL_PREVIEW) {
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
      health.mode === 'live' &&
      health.liveEnabled === true &&
      health.liveUrlEnabled === true &&
      health.killSwitch !== true &&
      health.jev?.hasApiKey === true;
    statusEl.dataset.state = 'ready';
    if (IS_LOCAL_PREVIEW) {
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

function renderObservation(graph, obs) {
  const uiPhrase = ALLOWED_UI_PHRASES.has(obs.ui_phrase) ? obs.ui_phrase : 'Insufficient context';
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

function renderClusterMembers(coverage) {
  const members = coverage.cluster?.members;
  if (!Array.isArray(members) || members.length === 0) return '';
  return members
    .map((member) => {
      const relation = (member.relation || 'unknown').replace(/_/g, ' ');
      const source = member.source || member.url || 'Unknown source';
      return `<li class="ml-cluster-item"><strong>${escapeHtml(source)}</strong> · ${escapeHtml(relation)}</li>`;
    })
    .join('');
}

function renderCoverageFrames(coverage) {
  if (!Array.isArray(coverage.frames) || coverage.frames.length === 0) {
    return 'No coverage-frame differences were recorded for this analysis. The schema includes a frames list; fusion currently leaves it empty.';
  }
  return coverage.frames
    .map((frame) => {
      if (typeof frame === 'string') return escapeHtml(frame);
      if (frame && typeof frame === 'object') return escapeHtml(JSON.stringify(frame));
      return '';
    })
    .filter(Boolean)
    .join(' ');
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
  const coverageObservations = graph.observations.filter((o) => o.dimension === 'coverage');
  const artifact = graph.artifact || {};

  byId('result-title').textContent = artifact.title || 'Untitled public article';
  byId('result-meta').textContent = formatArtifactMeta(artifact);

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
  byId('coverage-list').innerHTML = coverageObservations.map((o) => renderObservation(graph, o)).join('');

  byId('source-context-stats').innerHTML = renderSourceContextStats(graph.source_context);
  byId('source-context-note').textContent = graph.source_context?.note || '';

  byId('abstention-list').innerHTML = graph.abstentions.map(renderAbstention).join('');
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
    if (built.urlError) setUrlError(built.error);
    else showError(built.error);
    return;
  }
  lastPayload = built.payload;
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
  const built = lastPayload ? { payload: lastPayload } : buildPayload();
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
  checkHealth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
