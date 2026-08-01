import { analyzeMessage } from './scoring.js';

const form = document.querySelector('#analysis-form');
const message = document.querySelector('#message');
const count = document.querySelector('#character-count');
const results = document.querySelector('#results');

message.addEventListener('input', () => { count.textContent = `${message.value.length.toLocaleString()} / 1,500`; });

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const analysis = analyzeMessage(message.value);
  const tone = analysis.score >= 60 ? 'high' : analysis.score >= 38 ? 'medium' : 'low';
  const signalMarkup = analysis.signals.length
    ? analysis.signals.map((signal) => `<li><span class="result-dot"></span><div><strong>${signal.label}</strong><p>${signal.detail}</p><small>Found: “${signal.matches.join('”, “')}”</small></div></li>`).join('')
    : '<li><span class="result-dot"></span><div><strong>No strong pressure patterns found</strong><p>This message may still feel difficult. Context and your experience matter more than a text score.</p></div></li>';
  results.innerHTML = `<div class="score-head"><div class="score-ring ${tone}" style="--score:${analysis.score * 3.6}deg"><span><b>${analysis.score}</b><small>/ 100</small></span></div><div><small>Language pressure score</small><h3>${analysis.level}</h3><p>A reflection aid—not a verdict.</p></div></div><div class="found-signals"><h4>Signals worth noticing</h4><ul>${signalMarkup}</ul></div><div class="response-prompt"><small>A grounded response to adapt</small><p>“${analysis.response}”</p><button type="button" id="copy-response">Copy response</button></div>`;
  document.querySelector('#copy-response').addEventListener('click', async (event) => {
    await navigator.clipboard.writeText(analysis.response);
    event.currentTarget.textContent = 'Copied';
  });
});
