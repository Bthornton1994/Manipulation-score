import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';
import { detectSafetyNotice } from '../safety.js';
import {
  dailyBenign,
  autonomy,
  coercive,
  hardNeutral
} from './gold/corpus.js';
import {
  criticalSafetyCorpus,
  benignSafetyCorpus
} from './audit-v032-gate.test.js';

const BAND_RANK = { low: 0, moderate: 1, high: 2 };

function bandOf(result) {
  if (result.safetyNotice) return 'safety';
  if (result.abstained) return 'abstain';
  return (result.band?.id || 'low').toLowerCase();
}

function report(name, rows) {
  const ok = rows.filter((r) => r.pass).length;
  console.log(`[gold] ${name}: ${ok}/${rows.length} locked cases held`);
  return { name, ok, total: rows.length, rows };
}

test('gold: daily benign stays Low and has no safety notice', () => {
  assert.ok(dailyBenign.length >= 80, `daily benign size ${dailyBenign.length}`);
  const rows = dailyBenign.map((text) => {
    const result = analyzeMessage(text);
    const pass =
      !result.safetyNotice &&
      (result.abstained || result.score === null || result.score <= 30);
    return { text, pass, band: bandOf(result), score: result.score };
  });
  const summary = report('daily_benign', rows);
  const fails = rows.filter((r) => !r.pass);
  assert.equal(fails.length, 0, fails.map((f) => `${f.band}:${f.text}`).join(' | '));
  assert.ok(summary.ok === summary.total);
});

test('gold: supportive autonomy stays Low with no Moderate+ obligation', () => {
  assert.ok(autonomy.length >= 40, `autonomy size ${autonomy.length}`);
  const rows = autonomy.map((text) => {
    const result = analyzeMessage(text);
    const hotObligation = result.signals?.some(
      (s) =>
        s.id === 'obligation' &&
        (s.severity?.level === 'moderate' || s.severity?.level === 'strong')
    );
    const pass =
      !result.safetyNotice &&
      (result.abstained || result.score <= 30) &&
      !hotObligation;
    return { text, pass, band: bandOf(result), score: result.score };
  });
  const fails = rows.filter((r) => !r.pass);
  report('autonomy', rows);
  assert.equal(fails.length, 0, fails.map((f) => `${f.band}:${f.text}`).join(' | '));
});

test('gold: coercive cases meet the minimum band and keep listed functions', () => {
  assert.ok(coercive.length >= 40, `coercive size ${coercive.length}`);
  const rows = coercive.map((item) => {
    const words = (item.text.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
    const text =
      words >= 15
        ? item.text
        : `${item.text} I am including the rest of this conversation so there is enough English text to screen.`;
    const result = analyzeMessage(text);
    const got = bandOf(result);
    const rankOk =
      got !== 'safety' &&
      !result.abstained &&
      BAND_RANK[got] >= BAND_RANK[item.minBand];
    const functionsOk =
      !(item.functions || []).length ||
      (item.functions || []).some((id) => result.signals.some((s) => s.id === id));
    return {
      text: item.text,
      pass: rankOk && functionsOk,
      band: got,
      need: item.minBand
    };
  });
  const fails = rows.filter((r) => !r.pass);
  report('coercive', rows);
  assert.equal(
    fails.length,
    0,
    fails.map((f) => `need ${f.need} got ${f.band}: ${f.text}`).join(' | ')
  );
});

test('gold: locked safety must-catch still fires', () => {
  assert.ok(criticalSafetyCorpus.length >= 40);
  const extra = [
    'I will burn you alive if you try to sleep in the other room tonight.',
    'I will break your neck before you can tell anyone what happened here.',
    'I will cut you if you reach for the phone again tonight.',
    'I am going to drown you behind the house when nobody else can hear.',
    'I will poison your drink the next time you sit at this table.',
    'I will run you over with my car when you walk out of work.',
    'I will smash your face until nobody in this town recognizes you.',
    'I am going to beat you until you cannot stand up anymore tonight.',
    'I will shoot you the moment you step outside the front door.',
    'I am following you home after you told me to stop contacting you again.'
  ];
  const rows = [...criticalSafetyCorpus, ...extra].map((text) => ({
    text,
    pass: Boolean(detectSafetyNotice(text))
  }));
  const fails = rows.filter((r) => !r.pass);
  report('safety_catch', rows);
  assert.equal(fails.length, 0, fails.map((f) => f.text).join(' | '));
});

test('gold: locked safety must-not stays quiet, including paraphrases', () => {
  assert.ok(benignSafetyCorpus.length >= 40);
  const extra = [
    'In the novel the villain said he would burn the village, which the critic called cheap shock.',
    'During rehearsal the actor said I will shoot you on the mark when the director nods.',
    'The instructor used I will follow you home as an example of stalking language in training.',
    'I will shoot you the deck after legal signs off this afternoon.',
    'Point the knife away from your body while you dice onions on the board.',
    'Those heels are murder on your feet after a long wedding.',
    'The coach said it was a killer set but every move has a beginner option.',
    'I took your keys to get the spare copied because you asked me to.',
    'I installed a tracker in my suitcase so I can find it if the airline loses it.',
    'The documentary quoted I will find you while explaining how the case was built.'
  ];
  const rows = [...benignSafetyCorpus, ...extra].map((text) => ({
    text,
    pass: detectSafetyNotice(text) === null
  }));
  const fails = rows.filter((r) => !r.pass);
  report('safety_not', rows);
  assert.equal(fails.length, 0, fails.map((f) => f.text).join(' | '));
});

test('gold: hard neutrals near lexical hooks stay Low', () => {
  assert.ok(hardNeutral.length >= 20);
  const rows = hardNeutral.map((text) => {
    const result = analyzeMessage(text);
    const pass =
      !result.safetyNotice &&
      (result.abstained || result.score <= 30);
    return { text, pass, band: bandOf(result), score: result.score };
  });
  const fails = rows.filter((r) => !r.pass);
  report('hard_neutral', rows);
  assert.equal(fails.length, 0, fails.map((f) => `${f.band}:${f.text}`).join(' | '));
});
