import { analyzeMessage } from './scoring.js';

const form = document.querySelector('#analysis-form');
const message = document.querySelector('#message');
const count = document.querySelector('#character-count');
const results = document.querySelector('#results');
const exampleButton = document.querySelector('#load-example');
const clearButton = document.querySelector('#clear-message');
const navToggle = document.querySelector('#nav-toggle');

const EXAMPLE =
  "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function updateInputState() {
  count.textContent = `${message.value.length.toLocaleString()} / 1,500`;
  if (clearButton) clearButton.hidden = !message.value;
}

function createHighlightedMessage(text, highlights) {
  const container = element('div', 'highlighted-message');
  const heading = element('h4', '', 'Highlighted patterns');
  container.append(heading);

  const body = element('blockquote', 'highlighted-text');
  if (!highlights.length) {
    body.textContent = text;
    container.append(body);
    return container;
  }

  let pos = 0;
  for (const range of highlights) {
    if (range.start > pos) {
      body.append(document.createTextNode(text.slice(pos, range.start)));
    }
    const mark = element('mark', `highlight-${range.id}`);
    mark.title = range.label;
    mark.textContent = text.slice(range.start, range.end);
    body.append(mark);
    pos = Math.max(pos, range.end);
  }
  if (pos < text.length) {
    body.append(document.createTextNode(text.slice(pos)));
  }

  container.append(body);
  return container;
}

function createScoreHeader(analysis) {
  const tone = analysis.score >= 60 ? 'high' : analysis.score >= 38 ? 'medium' : 'low';
  const header = element('div', 'score-head');
  const ring = element('div', `score-ring ${tone}`);
  ring.style.setProperty('--score', `${analysis.score * 3.6}deg`);
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', `Pressure score ${analysis.score} out of 100`);

  const value = element('span');
  value.append(element('b', '', String(analysis.score)), element('small', '', '/ 100'));
  ring.append(value);

  const copy = element('div');
  copy.append(
    element('small', '', 'Language pressure score'),
    element('h3', '', analysis.level),
    element('p', '', 'A reflection aid—not a verdict. Scores reflect matched language patterns, not intent.')
  );
  header.append(ring, copy);
  return header;
}

function createSignalList(analysis) {
  const section = element('div', 'found-signals');
  section.append(element('h4', '', `Signals worth noticing · ${analysis.signalCount}`));
  const list = element('ul');

  const signals = analysis.signals.length
    ? analysis.signals
    : [{
        label: 'No strong pressure patterns found',
        detail: 'This message may still feel difficult. Context and your experience matter more than a text score.',
        matches: []
      }];

  for (const signal of signals) {
    const item = element('li');
    const content = element('div');
    content.append(element('strong', '', signal.label), element('p', '', signal.detail));
    if (signal.matches?.length) {
      content.append(element('small', '', `Found: “${signal.matches.join('”, “')}”`));
    }
    item.append(element('span', 'result-dot'), content);
    list.append(item);
  }

  section.append(list);
  return section;
}

function createCopyButton(text) {
  const button = element('button', 'copy-response', 'Copy response');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy the text above';
    }
  });
  return button;
}

function createResponseOptions(responses) {
  const section = element('div', 'response-options');
  section.append(element('h4', '', 'Grounded responses to adapt'));

  const styles = [
    { key: 'pause', label: 'Pause', description: 'Buy time without escalating.' },
    { key: 'boundary', label: 'Boundary', description: 'State what you won’t accept.' },
    { key: 'clarify', label: 'Clarify', description: 'Ask for more context.' }
  ];

  for (const style of styles) {
    const card = element('article', 'response-card');
    card.append(
      element('small', '', style.label),
      element('p', 'response-detail', style.description),
      element('p', 'response-text', `“${responses[style.key]}”`),
      createCopyButton(responses[style.key])
    );
    section.append(card);
  }

  return section;
}

function renderAnalysis(analysis, sourceText) {
  const children = [
    createScoreHeader(analysis),
    createHighlightedMessage(sourceText.trim(), analysis.highlights),
    createSignalList(analysis),
    createResponseOptions(analysis.responses)
  ];
  results.replaceChildren(...children);
  results.focus({ preventScroll: true });
}

function renderEmptyState() {
  results.innerHTML = `
    <div class="empty-state">
      <div class="radar"><span></span></div>
      <h3>Your analysis will appear here</h3>
      <p>We'll identify language patterns, explain why they matter, and offer calm response prompts.</p>
    </div>`;
}

message.addEventListener('input', updateInputState);

if (exampleButton) {
  exampleButton.addEventListener('click', () => {
    message.value = EXAMPLE;
    updateInputState();
    message.focus();
  });
}

if (clearButton) {
  clearButton.addEventListener('click', () => {
    form.reset();
    updateInputState();
    renderEmptyState();
    message.focus();
  });
}

if (navToggle) {
  navToggle.addEventListener('click', () => {
    const nav = document.querySelector('.site-nav');
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    nav.classList.toggle('open', !expanded);
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  renderAnalysis(analyzeMessage(message.value), message.value);
});

updateInputState();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
