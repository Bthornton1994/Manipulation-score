import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEWSJACK_ADAPTER_MODES, createNewsjackAdapter, emptyStoryContext } from '../media-lens/worker/adapters/newsjack.js';
import { createAuditLogger } from '../media-lens/worker/audit.js';
import { loadConfig, publicConfig } from '../media-lens/worker/config.js';
import { createServer } from '../media-lens/worker/server.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function importGraph(entry) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const source = readFileSync(file, 'utf8');
    const specifiers = [];
    for (const match of source.matchAll(IMPORT_PATTERN)) specifiers.push(match[1] || match[2] || match[3]);
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
  return seen;
}

test('the worker import graph never reaches the Newsjack operator tool or a process spawn outside Trafilatura', () => {
  const graph = importGraph(join(REPO_ROOT, 'media-lens/worker/server.js'));
  const files = [...graph.keys()].map((file) => relative(REPO_ROOT, file));
  assert.ok(files.length > 20, 'the walk found the worker modules');
  assert.deepEqual(files.filter((file) => file.startsWith('media-lens/tools/') || file.startsWith('scripts/')), []);
  const spawners = [...graph.entries()].filter(([, specifiers]) => specifiers.includes('node:child_process')).map(([file]) => relative(REPO_ROOT, file));
  assert.deepEqual(spawners, ['media-lens/worker/trafilatura-extract.js']);
  assert.ok(!files.includes('media-lens/schema/newsjack-capture.js'));
});

test('the capture contract, converter, pin, and raw validators are pure', () => {
  const pure = [
    'media-lens/worker/discovery/newsjack-discovery.js',
    'media-lens/worker/discovery/newsjack-pin.js',
    'media-lens/schema/newsjack-capture.js',
    'media-lens/tools/newsjack-raw.js'
  ];
  for (const file of pure) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const forbidden of ['process.env', 'node:child_process', 'node:http', 'node:https', 'node:net', 'node:fs', 'fetch(', 'Date.now(', 'new Date()']) {
      assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
    }
  }
  const runner = readFileSync(join(REPO_ROOT, 'media-lens/tools/newsjack-runner.js'), 'utf8');
  for (const forbidden of ['process.env', 'node:http', 'node:https', 'node:net', 'fetch(', 'shell: true', 'execSync', 'exec(']) {
    assert.ok(!runner.includes(forbidden), `runner must not use ${forbidden}`);
  }
  assert.ok(runner.includes('shell: false'));
});

test('the Newsjack adapter offers only fixture and disabled; removed modes fail at construction', async () => {
  assert.deepEqual([...NEWSJACK_ADAPTER_MODES], ['fixture', 'disabled']);
  for (const mode of ['artifacts', 'cli', 'live', undefined]) {
    assert.throws(() => createNewsjackAdapter({ mode }), /Unknown Newsjack adapter mode/);
  }
  const disabled = createNewsjackAdapter({ mode: 'disabled' });
  assert.deepEqual(await disabled.getStoryContext({}), emptyStoryContext('none'));
  assert.equal(disabled.discoverStoryDocument, undefined);

  const dir = await mkdtemp(join(tmpdir(), 'newsjack-adapter-'));
  await writeFile(join(dir, 'broken.json'), '{"story_origin": ');
  await writeFile(join(dir, 'wrong.json'), JSON.stringify({ story_origin: 'not an object' }));
  await writeFile(join(dir, 'good.json'), JSON.stringify({ story_origin: { same_story_assessment: 'same_story' }, freshness_gate: null, cluster: null }));
  const read = (fixtureId) => createNewsjackAdapter({ mode: 'fixture', fixtureId, fixtureDir: dir }).getStoryContext({});
  assert.deepEqual(await read('broken'), emptyStoryContext('none'));
  assert.deepEqual(await read('wrong'), emptyStoryContext('none'));
  assert.deepEqual(await read('missing'), emptyStoryContext('none'));
  assert.equal((await read('good')).provenance, 'fixture');
  assert.equal(existsSync(join(REPO_ROOT, 'media-lens/fixtures/newsjack/discovery-shaped.json')), false);
});

test('config no longer reads a Newsjack artifacts directory and /health has no Newsjack field', () => {
  const config = loadConfig({ MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR: '/srv/newsjack-run' });
  assert.equal(Object.hasOwn(config, 'newsjack'), false);
  assert.equal(Object.hasOwn(publicConfig(config), 'newsjack'), false);
  const configSource = readFileSync(join(REPO_ROOT, 'media-lens/worker/config.js'), 'utf8');
  assert.ok(!configSource.includes('MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR'));
});

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server));
  });
}

function postJson(server, path, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolvePost, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolvePost({ status: res.statusCode, body: JSON.parse(text) }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

// On main before this change, a live worker with
// MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR set ran an unguarded artifact reader on
// the public /analyze path after Jev: a malformed candidates.json returned
// 500 and the Jev calls already made were never counted in the budget.
test('a live worker reads no Newsjack artifacts on /analyze, so a malformed file cannot fail the request or skip the budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'newsjack-live-analyze-'));
  const artifacts = join(dir, 'newsjack-run');
  await mkdir(artifacts);
  await writeFile(join(artifacts, 'candidates.json'), '{"items": [');
  const budgetFile = join(dir, 'typesafe-budget.json');
  let providerCalls = 0;
  const provider = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      providerCalls += 1;
      const options = ['loaded_moralized', 'fear_threat', 'urgency', 'false_dilemma', 'identity_ingroup', 'scapegoating_dehumanizing', 'certainty_beyond_evidence', 'vague_authority', 'anecdote_generalization', 'bandwagon', 'adversarial_conflict_framing', 'none'];
      const probabilities = Object.fromEntries(options.map((option) => [option, option === 'none' ? 0.89 : 0.01]));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { influence_signal: { type: 'choice', choice: 'none', probabilities, confidence: 0.89 }, is_quoted_or_attributed: { type: 'noul', noul: 0.05 } } }));
    });
  });
  await listen(provider);
  const html = `<!doctype html><html lang="en"><head><title>Ferry schedule update</title></head><body><main><article>
    <p>The regional ferry operator published its winter timetable on Monday, adding two early crossings on weekdays.</p>
    <p>The timetable lists departure times for each pier and notes which sailings change during the holiday period.</p>
    <p>Riders can find the full schedule at each terminal and on the operator's public timetable page.</p>
  </article></main></body></html>`;
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'sk-test-key-not-for-logs',
    MEDIA_LENS_PORT: '0',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
    MEDIA_LENS_TYPESAFE_BUDGET_FILE: budgetFile,
    MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR: artifacts
  });
  const server = await listen(
    createServer(config, {
      auditLogger: createAuditLogger({ write: () => {} }),
      fetchArticle: async () => ({ html, contentType: 'text/html', fetchStatus: '200', fetchedAt: new Date().toISOString() })
    })
  );
  try {
    const response = await postJson(server, '/analyze', { user_asserted_public: true, mode: 'url', url: 'https://en.wikipedia.org/wiki/Ferry_schedule' });
    assert.equal(response.status, 200);
    assert.ok(providerCalls > 0, JSON.stringify(response.body.abstentions));
    assert.equal(response.body.engine.newsjack.mode, 'disabled');
    assert.deepEqual(response.body.engine.newsjack.artifacts, []);
    assert.equal(response.body.coverage.provenance, 'none');
    assert.ok(!response.body.privacy.external_processing.some((entry) => /newsjack/i.test(entry.recipient)));
    const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
    assert.equal(budget.calls, providerCalls, 'every Jev call is counted');
  } finally {
    server.close();
    provider.close();
  }
});
