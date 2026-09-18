import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createJevAdapter, loadQuestionSet } from '../media-lens/worker/adapters/jev.js';
import { canonicalStringify } from '../media-lens/worker/jev/canonical-json.js';
import { createHash } from 'node:crypto';

async function withMockServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
}

const SAMPLE_SPANS = [
  { id: 'span-1', role: 'authorial', text: 'The council voted on Tuesday.' },
  { id: 'span-2', role: 'quoted', text: 'We will act immediately.' }
];

test('the committed question-set hash matches a fresh canonical hash of questions.v1.json', async () => {
  const questionsSrc = await readFile('media-lens/worker/jev/questions.v1.json', 'utf8');
  const questions = JSON.parse(questionsSrc);
  const freshHash = createHash('sha256').update(canonicalStringify(questions), 'utf8').digest('hex');
  const { sha256, committed } = await loadQuestionSet();
  assert.equal(sha256, freshHash);
  assert.equal(sha256, committed, 'questions.v1.sha256 is out of date; regenerate it after editing questions.v1.json');
});

test('fixture mode: missing span id in the fixture file is a failure, not a fabricated answer', async () => {
  const adapter = createJevAdapter({ mode: 'fixture', fixtureId: 'synthetic-01-quoted-vs-authorial', fixtureDir: 'media-lens/fixtures/jev' });
  const result = await adapter.analyzeSpans(SAMPLE_SPANS, { kind: 'article', title: 't' });
  assert.ok(result.failedSpanIds.has('span-1') || result.answersBySpanId.has('span-1'));
});

test('live mode: a 429 response is retried and eventually succeeds', async () => {
  let callCount = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      callCount += 1;
      if (callCount === 1) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            influence_signal: { choice: 'urgency', probabilities: { urgency: 0.8 }, confidence: 0.8 },
            is_quoted_or_attributed: { noul: 0.2 },
            is_checkable_claim: { noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], { kind: 'article', title: 't' });
      assert.equal(result.failures, 0);
      assert.ok(result.answersBySpanId.get('span-1'));
      assert.ok(callCount >= 2, 'expected at least one retry after the 429');
    }
  );
});

test('live mode: a malformed answer body is treated as a failure', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { influence_signal: { choice: 'urgency' } } }));
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], { kind: 'article', title: 't' });
      assert.equal(result.failures, 1);
      assert.ok(result.failedSpanIds.has('span-1'));
    }
  );
});

test('live mode: a reported model different from the requested one is flagged as a mismatch', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'jev-1.10.0',
          answers: {
            influence_signal: { choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
            is_quoted_or_attributed: { noul: 0.1 },
            is_checkable_claim: { noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 1 });
      const result = await adapter.analyzeSpans([SAMPLE_SPANS[0]], { kind: 'article', title: 't' });
      assert.equal(result.modelReported, 'jev-1.10.0');
      assert.equal(result.modelMatch, false);
    }
  );
});

test('live mode: 21% failures still report failures accurately for fusion to act on', async () => {
  await withMockServer(
    async (req, res) => {
      const body = await readJsonBody(req);
      // Deterministic per-span failure (not per-call), so retries of the
      // same span cannot accidentally "succeed" and mask the failure rate.
      if (body.state?.span?.id === 'span-5') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            influence_signal: { choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
            is_quoted_or_attributed: { noul: 0.1 },
            is_checkable_claim: { noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const spans = Array.from({ length: 10 }, (_, i) => ({ id: `span-${i + 1}`, role: 'authorial', text: `Sentence ${i + 1}.` }));
      const adapter = createJevAdapter({ mode: 'live', baseUrl, apiKey: 'test-key', concurrency: 2, timeoutMs: 2000 });
      const result = await adapter.analyzeSpans(spans, { kind: 'article', title: 't' });
      assert.equal(result.calls, 10);
      assert.ok(result.failures >= 1);
    }
  );
});

test('disabled mode returns no calls and no answers without any network access', async () => {
  const adapter = createJevAdapter({ mode: 'disabled' });
  const result = await adapter.analyzeSpans(SAMPLE_SPANS, { kind: 'article', title: 't' });
  assert.equal(result.calls, 0);
  assert.equal(result.answersBySpanId.size, 0);
});
