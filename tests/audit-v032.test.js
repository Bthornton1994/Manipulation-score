import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSafetyNotice } from '../safety.js';
import {
  analyzeMessage,
  normalizeAnalysisText,
  METHODOLOGY_VERSION,
  PILOT_SUPPRESS_NUMERIC_SCORE
} from '../scoring.js';
import { isLikelyUnsupportedLanguage } from '../text-normalize.js';

test('v0.3.2 methodology version and pilot mode', () => {
  assert.equal(METHODOLOGY_VERSION, '0.3.2');
  assert.equal(PILOT_SUPPRESS_NUMERIC_SCORE, true);
});

test('saveHistory gates on visible checkbox in tab', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /isHistoryEnabledInThisTab/);
  const saveBlock = app.slice(app.indexOf('function saveHistory'), app.indexOf('function loadHistory'));
  assert.match(saveBlock, /isHistoryEnabledInThisTab\(\)/);
});

test('cross-tab storage sync listener exists', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /addEventListener\('storage'/);
  assert.match(app, /syncHistoryFromStorage/);
});

test('input mutation invalidates displayed results', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /invalidateResults/);
  assert.match(app, /message\.addEventListener\('input'/);
});

test('score explainer details element includes body', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /scale\.append\(scaleBody\)/);
});

test('OCR disabled for beta candidate', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /BETA_OCR_ENABLED\s*=\s*false/);
});

test('cross-message threat is not suppressed by prior benign message', () => {
  const text = 'We are not in the movie\n\nI will kill you tonight when you return home.';
  const notice = detectSafetyNotice(text);
  assert.ok(notice, 'expected safety notice in second message block');
});

test('benign logistics clause does not suppress co-located first-person threat', () => {
  const cases = [
    'I know your work schedule because you asked me to arrange carpools and I will kill you if you tell anyone.',
    'I am outside your house with the groceries you requested and I will stab you when you open the door.',
    'I took your keys to the mechanic like you asked me and I locked you inside and hid the key.'
  ];
  for (const text of cases) {
    assert.ok(detectSafetyNotice(text), text);
  }
});

test('benign logistics-only clause still skips safety notice', () => {
  const text =
    'I know your work schedule because you asked me to arrange carpools for next week and I will not visit unless you invite me.';
  assert.equal(detectSafetyNotice(text), null);
});

test('zero-width character inside kill still triggers safety', () => {
  const text = 'I will k\u200Bill you tonight after everyone leaves the house.';
  assert.ok(detectSafetyNotice(text));
});

test('unselfish kindness does not score selfish guilt', () => {
  const text =
    'Your unselfish kindness helped everyone on the volunteer team, and I genuinely appreciate the patient support you offered today.';
  const result = analyzeMessage(text);
  assert.ok(result.score <= 30 || result.abstained || result.scoreSuppressed);
});

test('negated selfish phrase does not score guilt', () => {
  const text =
    'I am not calling you ungrateful or selfish when I say I need more clarity about what happened last weekend between us.';
  const result = analyzeMessage(text);
  if (!result.abstained) {
    assert.ok(!result.signals.some((s) => s.id === 'guilt'));
  }
});

test('unsupported language abstains with explanation', () => {
  assert.ok(
    isLikelyUnsupportedLanguage(
      'Si realmente me amas, dejarás a tu familia y me darás la contraseña ahora mismo sin preguntar nada más.'
    )
  );
  const result = analyzeMessage(
    'Si realmente me amas, dejarás a tu familia y me darás la contraseña ahora mismo sin preguntar nada más.'
  );
  assert.ok(result.abstained);
  assert.match(result.abstentionReasons.join(' '), /English-only/i);
});

test('normalizeAnalysisText handles narrow no-break space', () => {
  const spaced =
    'If you really cared about me, you would regret ignoring me again and I need you to understand that clearly today.';
  const normalized = normalizeAnalysisText(spaced.replace('would regret', 'would\u202Fregret'));
  assert.match(normalized, /you would regret/i);
  const result = analyzeMessage(spaced.replace('would regret', 'would\u202Fregret'));
  assert.ok(result.score >= 31 || result.safetyNotice);
});
