// Media Lens renderer. Talks only to the local worker at the two loopback
// origins allowed by this page's CSP. This file runs in the browser and
// never reads Node-style environment variables, never writes to
// localStorage/sessionStorage/indexedDB, and never persists full article
// text: it only holds the current in-memory graph until the page is
// closed or a new analysis replaces it.

const WORKER_BASE_URL = 'http://127.0.0.1:8787';

const ALLOWED_UI_PHRASES = new Set([
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
]);

let currentGraph = null;
// L3: capture the moment the consent checkbox is actually checked, so the
// worker can record *that* timestamp as artifact.authorization.consent_at
// instead of only ever seeing server-receive time.
let consentCheckedAt = null;

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
    statusEl.dataset.state = 'ready';
    textEl.textContent = `Worker reachable: ${health.mode} mode.`;
    return true;
  } catch {
    statusEl.dataset.state = 'error';
    textEl.textContent =
      'No local worker found at 127.0.0.1:8787. Start it with: node media-lens/worker/server.js (from the repository root).';
    return false;
  }
}

function updateSubmitEnabled() {
  const consent = byId('consent-checkbox');
  const submit = byId('analyze-submit');
  submit.disabled = !consent.checked;
  consentCheckedAt = consent.checked ? new Date().toISOString() : null;
}

function setupInputModeToggle() {
  const radios = document.querySelectorAll('input[name="input-mode"]');
  const fixtureField = byId('fixture-field');
  const pastedField = byId('pasted-text-field');
  const urlField = byId('url-field');

  function apply() {
    const mode = document.querySelector('input[name="input-mode"]:checked')?.value || 'fixture';
    fixtureField.hidden = mode !== 'fixture';
    pastedField.hidden = mode !== 'pasted_text';
    urlField.hidden = mode !== 'url';
  }

  radios.forEach((radio) => radio.addEventListener('change', apply));
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
    showError('URL analysis is experimental and not production-ready. It is not available in this preview.');
    return;
  }

  const submitButton = byId('analyze-submit');
  submitButton.disabled = true;
  submitButton.textContent = 'Analyzing...';

  try {
    const res = await fetch(`${WORKER_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    if (!res.ok) {
      showError(body.message || `The worker returned an error (${res.status}).`);
      return;
    }
    renderGraph(body);
  } catch (err) {
    showError('Could not reach the local worker. Confirm it is running and try again.');
  } finally {
    submitButton.disabled = !byId('consent-checkbox').checked;
    submitButton.textContent = 'Analyze';
  }
}

function setup() {
  setupInputModeToggle();
  byId('consent-checkbox').addEventListener('change', updateSubmitEnabled);
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
