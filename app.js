import { analyzeMessage, SIGNALS } from './scoring.js';

const form = document.querySelector('#analysis-form');
const message = document.querySelector('#message');
const count = document.querySelector('#character-count');
const results = document.querySelector('#results');
const exampleSelect = document.querySelector('#example-select');
const clearButton = document.querySelector('#clear-message');
const navToggle = document.querySelector('#nav-toggle');
const navClose = document.querySelector('#nav-close');
const mobileMenu = document.querySelector('#mobile-menu');
const historyList = document.querySelector('#history-list');

const STORAGE_KEY = 'clarity-history-v1';
const MAX_HISTORY = 8;

const EXAMPLES = [
  {
    label: 'Guilt & isolation',
    text: "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you."
  },
  {
    label: 'Urgency & pressure',
    text: 'I need an answer immediately. This is your last chance before it is too late to fix this.'
  },
  {
    label: 'Responsibility shift',
    text: "After everything I've done for you, you should know this is your responsibility. You have to make this right."
  },
  {
    label: 'Implied withdrawal',
    text: "Fine, forget it. I guess I know where I stand. Don't bother reaching out if you can't make time for me."
  }
];

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function updateInputState() {
  count.textContent = `${message.value.length.toLocaleString()} / 2,500`;
  if (clearButton) clearButton.hidden = !message.value;
}

function createCopyButton(text, label = 'Copy') {
  const button = element('button', 'copy-chip', label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = label; }, 2000);
    } catch {
      button.textContent = 'Select text to copy';
    }
  });
  return button;
}

function appendHighlightedExcerpt(container, excerptData, signalId) {
  const block = element('blockquote', 'signal-excerpt');
  if (!excerptData.ranges.length) {
    block.textContent = excerptData.excerpt;
    container.append(block);
    return;
  }

  let pos = 0;
  const text = excerptData.excerpt;
  for (const range of excerptData.ranges) {
    if (range.start > pos) block.append(document.createTextNode(text.slice(pos, range.start)));
    const mark = element('mark', `highlight-${signalId}`);
    mark.textContent = text.slice(range.start, range.end);
    block.append(mark);
    pos = range.end;
  }
  if (pos < text.length) block.append(document.createTextNode(text.slice(pos)));
  if (excerptData.truncatedEnd) block.append(document.createTextNode('…'));
  container.append(block);
}

function createScoreSection(analysis) {
  const section = element('section', 'score-section');
  const tone = analysis.band?.id || 'low';

  const ring = element('div', `score-ring score-ring-lg ${tone}`);
  ring.style.setProperty('--score', `${analysis.score * 3.6}deg`);
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', `Manipulation Score ${analysis.score} out of 100`);

  const value = element('span', 'score-value');
  value.append(element('b', '', String(analysis.score)), element('small', '', '/ 100'));
  ring.append(value);

  const meta = element('div', 'score-meta');
  meta.append(
    element('p', 'score-label', 'Manipulation Score'),
    element('h3', 'score-band', analysis.level),
    element('p', 'score-summary', analysis.bandSummary || 'Paste a message to see how language patterns may be creating pressure.')
  );

  const scale = element('div', 'score-scale');
  scale.append(element('p', 'score-scale-title', 'What this number means'));
  const bands = element('ul', 'score-bands');
  [
    { label: 'Low', range: '0–30', note: 'Few or mild patterns' },
    { label: 'Moderate', range: '31–60', note: 'Several noticeable patterns' },
    { label: 'High', range: '61–100', note: 'Multiple strong patterns' }
  ].forEach((item) => {
    const li = element('li', item.label.toLowerCase() === analysis.level?.toLowerCase() ? 'active' : '');
    li.append(element('strong', '', `${item.label} (${item.range})`), element('span', '', item.note));
    bands.append(li);
  });
  scale.append(bands);
  scale.append(element('p', 'score-note', 'A reflection aid—not a verdict. Patterns are not proof of intent.'));

  const head = element('div', 'score-head');
  head.append(ring, meta);
  section.append(head, scale);
  return section;
}

function createPatternGuide() {
  const details = element('details', 'pattern-guide');
  const summary = element('summary', '', 'What these patterns mean');
  details.append(summary);
  const list = element('dl', 'pattern-guide-list');
  SIGNALS.forEach((signal) => {
    list.append(element('dt', '', signal.label), element('dd', '', signal.education));
  });
  details.append(list);
  return details;
}

function createSignalCard(signal) {
  const card = element('article', 'signal-card');
  const header = element('header', 'signal-card-head');
  header.append(
    element('h4', '', signal.label),
    element('span', `severity-badge severity-${signal.severity.level}`, signal.severity.label)
  );
  card.append(header);

  card.append(element('p', 'signal-why', signal.detail));

  const excerptWrap = element('div', 'signal-excerpt-wrap');
  excerptWrap.append(element('p', 'signal-excerpt-label', 'In your message'));
  appendHighlightedExcerpt(excerptWrap, signal.excerpt, signal.id);
  card.append(excerptWrap);

  const responses = element('div', 'signal-responses');
  responses.append(element('p', 'signal-responses-label', 'Responses you could adapt'));

  const pauseRow = element('div', 'response-row');
  pauseRow.append(element('p', 'response-text', `“${signal.responses.pause}”`), createCopyButton(signal.responses.pause, 'Copy'));
  responses.append(pauseRow);

  const boundaryRow = element('div', 'response-row');
  boundaryRow.append(element('p', 'response-text', `“${signal.responses.boundary}”`), createCopyButton(signal.responses.boundary, 'Copy'));
  responses.append(boundaryRow);

  card.append(responses);
  return card;
}

function createPatternsSection(analysis) {
  const section = element('section', 'patterns-section');
  section.append(element('h3', 'results-heading', `Detected patterns · ${analysis.signalCount}`));

  if (!analysis.signals.length) {
    const empty = element('div', 'patterns-empty');
    empty.append(
      element('p', '', 'No strong pressure patterns were matched in this text.'),
      element('p', 'patterns-empty-note', 'The message may still feel difficult. Your experience and context matter more than any score.')
    );
    section.append(empty);
    return section;
  }

  const list = element('div', 'signal-cards');
  analysis.signals
    .sort((a, b) => b.points - a.points)
    .forEach((signal) => list.append(createSignalCard(signal)));
  section.append(list);
  return section;
}

function createThreadSection(segmentAnalyses) {
  const section = element('section', 'thread-section');
  section.append(
    element('h3', 'results-heading', `Thread · ${segmentAnalyses.length} messages`),
    element('p', 'thread-note', 'Each message below was analyzed separately. Blank lines separate messages in your paste.')
  );

  const list = element('div', 'thread-cards');
  segmentAnalyses.forEach(({ index, text, analysis }) => {
    const card = element('article', 'thread-card');
    card.append(
      element('header', '', `Message ${index}`),
      element('p', 'thread-preview', text.length > 100 ? `${text.slice(0, 100)}…` : text),
      element('p', 'thread-score', `Score ${analysis.score} · ${analysis.level}`)
    );
    if (analysis.signals.length) {
      const tags = element('div', 'thread-tags');
      analysis.signals.forEach((s) => tags.append(element('span', 'thread-tag', s.label)));
      card.append(tags);
    }
    list.append(card);
  });
  section.append(list);
  return section;
}

function renderAnalysis(analysis, sourceText) {
  const children = [
    createScoreSection(analysis),
    createPatternsSection(analysis),
    createPatternGuide()
  ];

  if (analysis.segments?.length) {
    children.splice(1, 0, createThreadSection(analysis.segments));
  }

  results.replaceChildren(...children);
  results.focus({ preventScroll: true });
  saveHistory(sourceText, analysis);
  renderHistory();
}

function renderEmptyState() {
  results.innerHTML = `
    <div class="empty-state">
      <div class="radar"><span></span></div>
      <h3>Your analysis will appear here</h3>
      <p>Score, highlighted phrases, plain-language explanations, and calm response options.</p>
    </div>`;
}

function saveHistory(text, analysis) {
  try {
    const trimmed = text.trim();
    const items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    items.unshift({
      id: Date.now(),
      text: trimmed.slice(0, 2500),
      preview: trimmed.slice(0, 100),
      score: analysis.score,
      level: analysis.level,
      timestamp: Date.now()
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    /* localStorage unavailable */
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function renderHistory() {
  if (!historyList) return;
  const items = loadHistory();
  historyList.replaceChildren();
  if (!items.length) {
    historyList.append(element('p', 'history-empty', 'Recent analyses appear here—stored only on this device.'));
    return;
  }

  items.forEach((item) => {
    const button = element('button', 'history-item', '');
    button.type = 'button';
    button.append(
      element('span', 'history-score', `${item.score}`),
      element('span', 'history-preview', item.preview),
      element('span', 'history-meta', item.level)
    );
    button.addEventListener('click', () => {
      message.value = item.text || item.preview;
      updateInputState();
      renderAnalysis(analyzeMessage(message.value), message.value);
      message.focus();
    });
    historyList.append(button);
  });
}

function populateExamples() {
  if (!exampleSelect) return;
  EXAMPLES.forEach((example, index) => {
    const option = element('option', '', example.label);
    option.value = String(index);
    exampleSelect.append(option);
  });
}

message.addEventListener('input', updateInputState);

if (exampleSelect) {
  exampleSelect.addEventListener('change', () => {
    const example = EXAMPLES[Number(exampleSelect.value)];
    if (!example) return;
    message.value = example.text;
    updateInputState();
    message.focus();
  });
}

if (clearButton) {
  clearButton.addEventListener('click', () => {
    form.reset();
    if (exampleSelect) exampleSelect.value = '';
    updateInputState();
    renderEmptyState();
    message.focus();
  });
}

let menuScrollY = 0;

function openMobileMenu() {
  if (!mobileMenu) return;
  menuScrollY = window.scrollY;
  document.body.style.top = `-${menuScrollY}px`;
  mobileMenu.classList.add('is-open');
  mobileMenu.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
  if (navToggle) {
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', 'Close menu');
  }
}

function closeMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.remove('is-open');
  mobileMenu.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
  document.body.style.top = '';
  window.scrollTo(0, menuScrollY);
  if (navToggle) {
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
  }
}

if (navToggle) {
  navToggle.addEventListener('click', () => {
    if (mobileMenu?.classList.contains('is-open')) closeMobileMenu();
    else openMobileMenu();
  });
}

if (navClose) {
  navClose.addEventListener('click', closeMobileMenu);
}

if (mobileMenu) {
  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMobileMenu);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mobileMenu?.classList.contains('is-open')) {
    closeMobileMenu();
    navToggle?.focus();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  renderAnalysis(analyzeMessage(message.value), message.value);
});

populateExamples();
updateInputState();
renderHistory();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
