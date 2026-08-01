import { analyzeMessage } from './scoring.js';

const form = document.querySelector('#analysis-form');
const message = document.querySelector('#message');
const count = document.querySelector('#character-count');
const results = document.querySelector('#results');
const exampleButton = document.querySelector('#load-example');
const clearButton = document.querySelector('#clear-message');
const EXAMPLE = "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function updateInputState() {
  count.textContent = `${message.value.length.toLocaleString()} / 1,500`;
  clearButton.hidden = !message.value;
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
  copy.append(element('small', '', 'Language pressure score'), element('h3', '', analysis.level), element('p', '', 'A reflection aid—not a verdict.'));
  header.append(ring, copy);
  return header;
}

function createSignalList(analysis) {
  const section = element('div', 'found-signals');
  section.append(element('h4', '', `Signals worth noticing · ${analysis.signalCount}`));
  const list = element('ul');
  const signals = analysis.signals.length ? analysis.signals : [{
    label: 'No strong pressure patterns found',
    detail: 'This message may still feel difficult. Context and your experience matter more than a text score.',
    matches: []
  }];
  signals.forEach((signal) => {
    const item = element('li');
    const content = element('div');
    content.append(element('strong', '', signal.label), element('p', '', signal.detail));
    if (signal.matches.length) content.append(element('small', '', `Found: “${signal.matches.join('”, “')}”`));
    item.append(element('span', 'result-dot'), content);
    list.append(item);
  });
  section.append(list);
  return section;
}

function createResponse(analysis) {
  const card = element('div', 'response-prompt');
  const button = element('button', '', 'Copy response');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(analysis.response);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy the text above';
    }
  });
  card.append(element('small', '', 'A grounded response to adapt'), element('p', '', `“${analysis.response}”`), button);
  return card;
}

function renderAnalysis(analysis) {
  results.replaceChildren(createScoreHeader(analysis), createSignalList(analysis), createResponse(analysis));
  results.focus({ preventScroll: true });
}

message.addEventListener('input', updateInputState);
exampleButton.addEventListener('click', () => {
  message.value = EXAMPLE;
  updateInputState();
  message.focus();
});
clearButton.addEventListener('click', () => {
  form.reset();
  updateInputState();
  message.focus();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  renderAnalysis(analyzeMessage(message.value));
});
