import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createJevAdapter, loadQuestionSet, buildContractAnswers, JEV_MODEL_REQUESTED } from '../media-lens/worker/adapters/jev.js';
import { runCalibrationCases, CALIBRATION_DISCLAIMER } from '../media-lens/worker/jev/calibration.js';

const MANIFEST_PATH = 'media-lens/fixtures/jev-calibration/manifest.json';
const FIXTURE_DIR = 'media-lens/fixtures/jev-calibration';

async function loadCases() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  return manifest.cases;
}

function mockAnswersForCase(optionIds, labeled) {
  if (labeled.id === 'cal-unavailable') return { status: 401, body: { error: 'unauthorized' } };
  if (labeled.id === 'cal-malformed') {
    return {
      status: 200,
      body: {
        model: JEV_MODEL_REQUESTED,
        answers: {
          influence_signal: { type: 'choice', choice: 'verified_true', probabilities: { verified_true: 1 }, confidence: 1 },
          is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
        }
      }
    };
  }
  const byId = {
    'cal-urgency-positive': { choice: 'urgency', probability: 0.82, noul: 0.08 },
    'cal-none-negative': { choice: 'none', probability: 0.91, noul: 0.06 },
    'cal-quoted-urgency': { choice: 'urgency', probability: 0.74, noul: 0.92 },
    'cal-false-positive': { choice: 'urgency', probability: 0.77, noul: 0.1 },
    'cal-false-negative': { choice: 'none', probability: 0.88, noul: 0.12 },
    'cal-low-confidence-review': { choice: 'bandwagon', probability: 0.41, noul: 0.11, confidence: 0.41 }
  };
  const spec = byId[labeled.id];
  return {
    status: 200,
    body: {
      model: JEV_MODEL_REQUESTED,
      answers: buildContractAnswers({ optionIds, ...spec })
    }
  };
}

test('fixture-mode calibration measures FP, FN, abstention, and review on labeled synthetic cases', async () => {
  const cases = await loadCases();
  const summary = await runCalibrationCases(cases, { mode: 'fixture', fixtureDir: FIXTURE_DIR });
  assert.equal(summary.disclaimer, CALIBRATION_DISCLAIMER);
  assert.equal(summary.n, 8);
  assert.equal(summary.tp, 3);
  assert.equal(summary.fp, 1);
  assert.equal(summary.fn, 1);
  assert.equal(summary.tn, 1);
  assert.equal(summary.abstentions, 2);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.exact_match, 4);
  assert.match(summary.disclaimer, /Not representative real-world accuracy/);
});

test('live-shaped mock HTTP calibration matches the fixture-mode confusion counts', async () => {
  const cases = await loadCases();
  const { optionIds } = await loadQuestionSet();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const spanText = body.state?.span?.text;
      const labeled = cases.find((item) => item.span.text === spanText);
      const mapped = labeled ? mockAnswersForCase(optionIds, labeled) : { status: 500, body: { error: 'unknown_case' } };
      res.writeHead(mapped.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(mapped.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const summary = await runCalibrationCases(cases, {
      mode: 'live',
      baseUrl,
      apiKey: 'test-key',
      timeoutMs: 1000,
      concurrency: 1
    });
    assert.equal(summary.tp, 3);
    assert.equal(summary.fp, 1);
    assert.equal(summary.fn, 1);
    assert.equal(summary.tn, 1);
    assert.equal(summary.abstentions, 2);
    assert.equal(summary.reviews, 1);
  } finally {
    server.close();
  }
});

test('calibration cases never include private-message content or API keys', async () => {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{16,}/);
  assert.doesNotMatch(raw, /MEDIA_LENS_TYPESAFE_API_KEY\s*=\s*\S+/);
  const cases = await loadCases();
  for (const labeled of cases) {
    assert.equal(labeled.artifact.kind, 'article');
    assert.doesNotMatch(labeled.span.text, /password|ssn|private message/i);
  }
});

test('fixture-mode calibration does not call fetch', async () => {
  let fetchHits = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchHits += 1;
    return originalFetch(...args);
  };
  try {
    const cases = await loadCases();
    await runCalibrationCases(cases, { mode: 'fixture', fixtureDir: FIXTURE_DIR });
    assert.equal(fetchHits, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createJevAdapter fixture mode still loads the pinned question set for option validation', async () => {
  const adapter = createJevAdapter({
    mode: 'fixture',
    fixtureId: 'cal-urgency-positive',
    fixtureDir: FIXTURE_DIR
  });
  const result = await adapter.analyzeSpans(
    [{ id: 'span-1', role: 'authorial', text: 'Time is running out. Act this hour or lose your only chance forever.' }],
    { kind: 'article', title: 'Synthetic calibration urgency' }
  );
  assert.equal(result.failures, 0);
  assert.equal(result.answersBySpanId.get('span-1').influence_signal.choice, 'urgency');
  assert.equal(result.modelMatch, true);
});
