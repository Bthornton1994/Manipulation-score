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

const ALLOWED_UI_PHRASES = new Set([
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
]);

let currentGraph = null;
let liveUrlReady = false;
let isSubmitting = false;
// L3: capture the moment the consent checkbox is actually checked, so the
// worker can record *that* timestamp as artifact.authorization.consent_at
// instead of only ever seeing server-receive time.
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

function updateUrlInputAvailability() {
  const articleUrl = byId('article-url');
  const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'fixture';
  if (articleUrl) articleUrl.disabled = mode !== 'url' || IS_LOCAL_PREVIEW || !liveUrlReady;
}

function byId(id) {
  return document.getElementById(id);
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

function updateSubmitEnabled() {
  const consent = byId('consent-checkbox');
  const submit = byId('analyze-submit');
  const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'fixture';
  const articleUrl = byId('article-url')?.value.trim() || '';
  const hasInput =
    mode === 'fixture' ||
    (mode === 'pasted_text' && byId('pasted-text')?.value.trim()) ||
    (mode === 'url' && articleUrl && liveUrlReady);
  submit.disabled = isSubmitting || !consent.checked || !hasInput;
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

  if (!IS_LOCAL_PREVIEW) {
    fixtureRadio.disabled = true;
    pastedRadio.disabled = true;
    fixtureRadio.closest('label').hidden = true;
    pastedRadio.closest('label').hidden = true;
    urlRadio.checked = true;
  }

  function apply() {
    const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'fixture';
    fixtureField.hidden = mode !== 'fixture';
    pastedField.hidden = mode !== 'pasted_text';
    urlField.hidden = mode !== 'url';
    updateUrlInputAvailability();
    updateSubmitEnabled();
  }

  radios.forEach((radio) => radio.addEventListener('change', apply));
  articleUrl.addEventListener('input', updateSubmitEnabled);
  apply();
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

function renderObservation(graph, obs) {
  const uiPhrase = ALLOWED_UI_PHRASES.has(obs.ui_phrase) ? obs.ui_phrase : 'Insufficient context';
  const spanText = obs.localization === 'span' ? findSpanText(graph, obs.span_ids) : null;
  return `
    <li class="ml-observation">
      <div class="ml-observation-head">
        ${chip(uiPhrase, { 'data-strength': obs.strength })}
        ${obs.review_status === 'needs_review' ? chip('Needs review', { 'data-review': 'needs_review' }) : ''}
      </div>
      ${spanText ? `<p class="ml-observation-quote">&ldquo;${escapeHtml(spanText)}&rdquo;</p>` : ''}
      <p class="ml-observation-explain">Signal: ${escapeHtml(obs.signal.replace(/_/g, ' '))}</p>
    </li>
  `;
}

function renderClaim(graph, claim) {
  const supportLabel = claim.support === 'not_checked' ? 'Not checked' : claim.support.replace(/_/g, ' ');
  // L5: a quoted claim is someone else's words, not the author's own
  // assertion — show that distinction instead of rendering it identically
  // to an authorial claim.
  const isQuoted = claim.attribution !== 'authorial';
  return `
    <li class="ml-claim">
      <div class="ml-observation-head">
        ${chip(supportLabel)}
        ${isQuoted ? chip('Quoted', { 'data-attribution': 'quoted' }) : ''}
      </div>
      <p class="ml-observation-quote">${escapeHtml(claim.text)}</p>
    </li>
  `;
}

function renderAbstention(abstention) {
  return `<li class="ml-abstention">${escapeHtml(abstention.message)}</li>`;
}

function renderCoverageStats(coverage) {
  const stats = [];
  if (coverage.cluster) {
    stats.push(['Independent sources', String(coverage.cluster.independent_sources_estimate)]);
    stats.push(['Duplicate or syndicated', String(coverage.cluster.duplicate_or_syndicated_count)]);
  }
  // M2: freshness_gate.computed_status and its rationale (e.g. "Origin not
  // yet corroborated") were computed by fusion but never shown; without
  // this row a user has no way to see why a story is or isn't "fresh".
  if (coverage.freshness_gate) {
    stats.push(['Freshness', coverage.freshness_gate.computed_status.replace(/_/g, ' ')]);
  }
  stats.push(['Coverage confidence', coverage.confidence]);
  stats.push(['Provenance', coverage.provenance.replace(/_/g, ' ')]);
  return stats.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function renderSourceContextStats(sourceContext) {
  const stats = [
    ['Domain', sourceContext.canonical_domain || 'Unknown'],
    ['Has byline', sourceContext.metadata.has_byline ? 'Yes' : 'No'],
    ['Has published time', sourceContext.metadata.has_published_time ? 'Yes' : 'No'],
    ['Has canonical link', sourceContext.metadata.has_canonical ? 'Yes' : 'No']
  ];
  return stats.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function renderGraph(graph) {
  currentGraph = graph;

  const languageObservations = graph.observations.filter((o) => o.dimension === 'language');
  const coverageObservations = graph.observations.filter((o) => o.dimension === 'coverage');

  byId('language-list').innerHTML =
    languageObservations.map((o) => renderObservation(graph, o)).join('') ||
    '<li class="ml-empty-state">No language signals reached the reporting threshold for this text.</li>';

  byId('claims-list').innerHTML =
    graph.claims.map((c) => renderClaim(graph, c)).join('') || '<li class="ml-empty-state">No checkable-looking claims were found.</li>';

  byId('coverage-stats').innerHTML = renderCoverageStats(graph.coverage);
  byId('coverage-freshness-rationale').textContent = graph.coverage.freshness_gate?.rationale || '';
  byId('coverage-list').innerHTML = coverageObservations.map((o) => renderObservation(graph, o)).join('');

  byId('source-context-stats').innerHTML = renderSourceContextStats(graph.source_context);

  byId('abstention-list').innerHTML = graph.abstentions.map(renderAbstention).join('');

  byId('results').hidden = false;

  // Info: announce a short summary through the dedicated status line
  // instead of aria-live on the whole results tree, which would re-read
  // every observation, claim, and stat aloud on every update.
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

function showError(message) {
  const el = byId('analyze-error');
  el.hidden = false;
  el.textContent = message;
  announceStatus(message);
}

function clearError() {
  byId('analyze-error').hidden = true;
  byId('article-url').setAttribute('aria-invalid', 'false');
}

function setUrlError(message) {
  byId('article-url').setAttribute('aria-invalid', 'true');
  showError(message);
}

function apiErrorMessage(body, status) {
  switch (body?.error) {
    case 'live_url_not_allowlisted':
      return 'This source is not currently approved for live analysis. Try an approved public URL.';
    case 'oversized_input':
      return OVERSIZED_INPUT_MESSAGE;
    case 'live_killed':
      return 'Live analysis is temporarily paused by the operator. No analysis was run.';
    case 'live_url_disabled':
      return 'Live URL analysis is temporarily unavailable. No analysis was run.';
    case 'rate_limited':
      return body.message || 'The service is busy. Wait a minute and try again.';
    default:
      return body?.message || `The Media Lens service returned an error (${status}).`;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearError();

  const consent = byId('consent-checkbox').checked;
  if (!consent) {
    showError('Check the consent box before analyzing.');
    return;
  }

  const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'fixture';
  const payload = { user_asserted_public: true, mode, consent_at: consentCheckedAt };

  if (mode === 'fixture') {
    payload.fixture_id = byId('fixture-select').value;
  } else if (mode === 'pasted_text') {
    payload.text = byId('pasted-text').value;
    payload.kind = 'other_public';
  } else if (mode === 'url') {
    const url = byId('article-url').value.trim();
    if (!url) {
      setUrlError('Enter an approved public URL.');
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      setUrlError('Enter a complete https:// URL.');
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      setUrlError('Use an https:// public URL.');
      return;
    }
    if (IS_LOCAL_PREVIEW) {
      showError('Live URL analysis is available from the approved Media Lens host. Use a fixture example for local development.');
      return;
    }
    if (!liveUrlReady) {
      showError('Live URL analysis is temporarily unavailable. No analysis was run.');
      return;
    }
    payload.url = url;
    payload.kind = 'article';
  }

  const submitButton = byId('analyze-submit');
  isSubmitting = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Analyzing...';
  byId('analyze-form').setAttribute('aria-busy', 'true');

  try {
    const res = await fetch(`${WORKER_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(apiErrorMessage(body, res.status));
      return;
    }
    renderGraph(body);
  } catch (err) {
    showError(IS_LOCAL_PREVIEW ? 'Could not reach the local worker. Confirm it is running and try again.' : 'Could not reach the Media Lens service. Try again later.');
  } finally {
    isSubmitting = false;
    byId('analyze-form').removeAttribute('aria-busy');
    updateSubmitEnabled();
    submitButton.textContent = 'Analyze';
  }
}

function setup() {
  setupInputModeToggle();
  byId('consent-checkbox').addEventListener('change', updateSubmitEnabled);
  byId('pasted-text').addEventListener('input', updateSubmitEnabled);
  byId('analyze-form').addEventListener('submit', handleSubmit);
  byId('export-json-btn').addEventListener('click', () => {
    if (!currentGraph) {
      showError('Run an analysis before exporting.');
      return;
    }
    downloadJson('influence-graph', toEvidenceOnlyExport(currentGraph));
  });
  checkHealth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
