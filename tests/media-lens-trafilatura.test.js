import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../media-lens/worker/server.js';
import { analyze } from '../media-lens/worker/analyze.js';
import { createJevAdapter } from '../media-lens/worker/adapters/jev.js';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { enginePreparation, prepareFromHtml, prepareFromPastedText } from '../media-lens/worker/prepare.js';
import {
  PY3LANGID_VERSION,
  TRAFILATURA_VERSION,
  createExtractionGate,
  extractLocalArticle,
  runExtractor,
  schemaLanguage
} from '../media-lens/worker/trafilatura-extract.js';
import { validate } from '../media-lens/schema/validate.js';

const SCRIPT = fileURLToPath(new URL('../media-lens/worker/trafilatura/extract_html.py', import.meta.url));
const SECRET = 'secret-nav-marker-9f3c2a';
const COMMENT = 'secret-html-comment-marker-17b';

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function runScript(payload) {
  return spawnSync('python3', [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15000
  });
}

function analyzePrepared(prepared) {
  return analyze({
    prepared,
    config: loadConfig({}),
    jevAdapter: createJevAdapter({ mode: 'disabled' }),
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-18T00:00:00.000Z'
  });
}

const NAV_HTML = `<!doctype html>
<html lang="en">
<body>
<nav><p>Home Sports Weather ${SECRET} subscribe to the morning newsletter.</p></nav>
<div class="sidebar"><p>Related coverage from last year stays in the sidebar and is not the story.</p></div>
<h1>Council approves drainage</h1>
<p class="byline">By Ada Lovelace</p>
<p>"We will fix the flooding," the mayor said after the vote.</p>
<p>The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets.</p>
<footer><p>Copyright 2026 Fictional Daily. Share this article with a friend.</p></footer>
<!-- ${COMMENT} -->
</body>
</html>`;

test('pinned Trafilatura and py3langid versions match the worker requirements file', async () => {
  const requirements = await readFile('media-lens/worker/trafilatura/requirements.txt', 'utf8');
  const script = await readFile('media-lens/worker/trafilatura/extract_html.py', 'utf8');
  const deps = await readFile('media-lens/worker/trafilatura/DEPS.md', 'utf8');
  assert.match(requirements, new RegExp(`^trafilatura==${TRAFILATURA_VERSION}$`, 'm'));
  assert.match(requirements, new RegExp(`^py3langid==${PY3LANGID_VERSION}$`, 'm'));
  assert.match(script, new RegExp(`REQUIRED_TRAFILATURA = "${TRAFILATURA_VERSION}"`));
  assert.match(script, new RegExp(`REQUIRED_PY3LANGID = "${PY3LANGID_VERSION}"`));
  assert.match(deps, /Apache-2\.0/);
  assert.match(deps, new RegExp(TRAFILATURA_VERSION));
  assert.match(script, /socket\.socket\.connect_ex = _refuse_socket_method/);
  assert.match(deps, /not a kernel network namespace/);
});

test('extractor refuses a fetch request and does not echo article text on that refusal', () => {
  const refused = runScript({ fetch_url: 'https://example.invalid/article', html: `<p>${SECRET}</p>` });
  assert.equal(refused.status, 0);
  const payload = JSON.parse(refused.stdout);
  assert.equal(payload.status, 'error');
  assert.equal(payload.error_code, 'fetch_refused');
  assert.equal(payload.text, null);
  assert.equal(refused.stdout.includes(SECRET), false);
  assert.equal((refused.stderr || '').includes(SECRET), false);
});

test('extractor reads HTML already in hand and does not need a URL', async () => {
  const html = `<html lang="en"><head><link rel="canonical" href="https://example.invalid/story"></head><body><article><h1>Council vote</h1><p>The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets.</p></article></body></html>`;
  const result = await extractLocalArticle(html);
  assert.equal(result.status, 'ok');
  assert.equal(result.extractor_version, TRAFILATURA_VERSION);
  assert.equal(result.language_detector_version, PY3LANGID_VERSION);
  assert.match(result.text, /council voted on Tuesday/);
  assert.doesNotMatch(result.text, /example\.invalid/);
});

test('navigation and sidebar boilerplate stay out of prepared spans while quoted body text remains an exact slice', async () => {
  const prepared = await prepareFromHtml({ html: NAV_HTML, sourceUrl: 'https://fictional-daily.example/nav', inputMode: 'fixture' });
  assert.equal(prepared.extraction.status, 'ok');
  assert.equal(prepared.artifact.language, 'en');
  assert.equal(prepared.spans.some((span) => span.text.includes(SECRET)), false);
  assert.equal(prepared.preparedText.includes('Related coverage from last year'), false);
  assert.equal(prepared.preparedText.includes('Copyright 2026'), false);
  assert.match(prepared.preparedText, /council voted on Tuesday/);
  const quoted = prepared.spans.find((span) => span.role === 'quoted');
  assert.ok(quoted);
  assert.equal(quoted.attribution.speaker, 'the mayor');
  assert.equal(prepared.preparedText.slice(quoted.start, quoted.end), quoted.text);
  for (const span of prepared.spans) {
    assert.equal(prepared.preparedText.slice(span.start, span.end), span.text);
  }
  assert.equal(prepared.spans.some((span) => span.role === 'byline_meta'), false);
  assert.equal(prepared.preparedText.includes('By Ada Lovelace'), false);
});

test('preparation retains the body hash, extractor version, and metadata without the raw HTML', async () => {
  const html = `<!doctype html><html lang="en"><head>
    <meta property="og:title" content="Some headline" />
    <meta property="og:site_name" content="Fictional Daily" />
  </head><body><article><h1>Some headline</h1><p>Enough authorial text to be analyzable in this test case for the drainage vote.</p></article><!-- ${COMMENT} --></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/articles/x', inputMode: 'fixture' });
  assert.equal(prepared.extraction.bodySha256, sha256(html));
  assert.equal(prepared.artifact.publisherName, 'Fictional Daily');
  assert.equal(prepared.artifact.title, 'Some headline');
  const preparation = enginePreparation(prepared);
  assert.equal(preparation.extractor, 'trafilatura');
  assert.equal(preparation.extractor_version, '2.2.0');
  assert.equal(preparation.extraction_status, 'ok');
  assert.equal(preparation.body_sha256, sha256(html));
  assert.equal(preparation.fetch_status, 'not_fetched');
  assert.equal(JSON.stringify(preparation).includes(COMMENT), false);
  assert.equal(JSON.stringify(preparation).includes(html), false);
});

test('missing metadata can be filled from extraction without labeling the publisher as the hostname', async () => {
  const html = `<html lang="en"><body><h1>Neighborhood cleanup</h1><p>Volunteers will meet at the riverfront trail on Saturday morning to collect litter and sort recycling.</p></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/cleanup', inputMode: 'fixture' });
  assert.equal(prepared.artifact.title, 'Neighborhood cleanup');
  assert.equal(prepared.artifact.publisherName, null);
  assert.equal(prepared.artifact.byline, null);
});

test('non-English and disagreed language labels stay und and do not produce a finding', async () => {
  const spanish = `<html lang="es"><body><article><h1>El consejo aprueba el drenaje</h1><p>El ayuntamiento votó el martes para aprobar una obra de drenaje en el centro después de tres temporadas de inundaciones repetidas en el distrito.</p><p>El alcalde dijo que las obras empezarán este año y que el presupuesto ya está reservado para los vecinos.</p></article></body></html>`;
  const disagreed = spanish.replace('lang="es"', 'lang="en"');
  for (const html of [spanish, disagreed]) {
    const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/es', inputMode: 'fixture' });
    assert.equal(prepared.artifact.language, 'und');
    let calls = 0;
    const graph = await analyze({
      prepared,
      config: loadConfig({}),
      jevAdapter: {
        mode: 'disabled',
        analyzeSpans: async () => {
          calls += 1;
          return { answersBySpanId: {}, failedSpanIds: [], calls: 0, failures: 0, elapsedMs: 0, modelReported: null, modelMatch: null };
        }
      },
      newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
      userAssertedPublic: true,
      consentAt: '2026-09-18T00:00:00.000Z'
    });
    assert.equal(calls, 0);
    assert.equal(graph.observations.length, 0);
    assert.equal(graph.artifact.language, 'und');
    assert.ok(graph.abstentions.some((item) => item.reason === 'unsupported_language'));
    assert.equal(graph.privacy.full_text_persisted, false);
    assert.equal(validate(graph).valid, true);
  }
});

test('unknown language is und rather than English', () => {
  assert.equal(schemaLanguage({ detected: null, htmlLang: 'en' }), 'und');
  assert.equal(schemaLanguage({ detected: 'es', htmlLang: null }), 'und');
  assert.equal(schemaLanguage({ detected: 'en', htmlLang: 'en-US' }), 'en');
  assert.equal(schemaLanguage({ detected: 'en', htmlLang: null }), 'en');
});

test('empty, malformed, and unsupported inputs stay distinct and do not analyze', async () => {
  const cases = [
    { html: '', status: 'empty' },
    { html: '   ', status: 'empty' },
    { html: '{"title":"not html"}', status: 'unsupported' },
    { html: '%PDF-1.7 binary', status: 'unsupported' },
    { html: '<html><', status: 'empty' },
    { html: '<html></html>', status: 'empty' }
  ];
  for (const item of cases) {
    const prepared = await prepareFromHtml({ html: item.html, sourceUrl: 'https://fictional-daily.example/bad', inputMode: 'fixture' });
    assert.equal(prepared.extraction.status, item.status, item.html);
    assert.equal(prepared.spans.length, 0);
    assert.equal(prepared.artifact.language, 'und');
    const graph = await analyzePrepared(prepared);
    assert.equal(graph.observations.length, 0);
    assert.ok(graph.abstentions.some((entry) => entry.reason === 'engine_failure'));
    assert.equal(graph.abstentions.some((entry) => entry.message.includes('no relevant content')), false);
    assert.equal(validate(graph).valid, true);
  }
});

test('parse_failed stays distinct from an empty extraction', async () => {
  const prepared = await prepareFromHtml({
    html: '<html><p>Visible paragraph that must not be analyzed after a parse failure.</p></html>',
    sourceUrl: 'https://fictional-daily.example/parse',
    inputMode: 'fixture',
    extractImpl: () => ({ status: 'parse_failed', error_code: 'extract_exception', extractor_version: TRAFILATURA_VERSION })
  });
  const graph = await analyzePrepared(prepared);
  assert.equal(prepared.extraction.status, 'parse_failed');
  assert.equal(graph.observations.length, 0);
  assert.ok(graph.abstentions.some((entry) => entry.message.startsWith('The page could not be parsed')));
  assert.equal(graph.abstentions.some((entry) => entry.message.includes('could not be extracted')), false);
});

test('an extractor error is an engine failure and does not call Jev', async () => {
  const prepared = await prepareFromHtml({
    html: '<html lang="en"><body><p>Visible paragraph that must not be analyzed after an extractor error.</p></body></html>',
    sourceUrl: 'https://fictional-daily.example/err',
    inputMode: 'url',
    acquisition: { contentType: 'text/html', fetchStatus: '200', fetchedAt: '2026-09-24T00:00:00.000Z' },
    extractImpl: () => ({ status: 'error', error_code: 'spawn_failed', extractor_version: TRAFILATURA_VERSION })
  });
  assert.equal(prepared.extraction.fetchStatus, '200');
  assert.equal(prepared.preparedText.includes('Visible paragraph'), false);
  let calls = 0;
  const graph = await analyze({
    prepared,
    config: loadConfig({}),
    jevAdapter: {
      mode: 'disabled',
      analyzeSpans: async () => {
        calls += 1;
        return { answersBySpanId: {}, failedSpanIds: [], calls: 0, failures: 0, elapsedMs: 0, modelReported: null, modelMatch: null };
      }
    },
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: null
  });
  assert.equal(calls, 0);
  assert.equal(graph.engine.preparation.extraction_status, 'error');
  assert.equal(graph.engine.preparation.extractor_version, TRAFILATURA_VERSION);
  assert.ok(graph.abstentions.some((entry) => entry.reason === 'engine_failure' && entry.message.startsWith('Article extraction failed')));
});

test('preparation does not log the article text', async () => {
  const logs = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'].map((method) => [method, console[method]]);
  for (const [method] of originals) {
    console[method] = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  }
  try {
    const prepared = await prepareFromHtml({ html: NAV_HTML, sourceUrl: 'https://fictional-daily.example/nav', inputMode: 'fixture' });
    assert.match(prepared.preparedText, /council voted/);
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
  const joined = logs.join('\n');
  assert.equal(joined.includes(SECRET), false);
  assert.equal(joined.includes('council voted on Tuesday'), false);
});

test('pasted text is not labeled English when detection disagrees', async () => {
  const prepared = await prepareFromPastedText({
    text: 'El ayuntamiento votó el martes para aprobar una obra de drenaje en el centro después de tres temporadas de inundaciones repetidas en el distrito. El alcalde dijo que las obras empezarán este año.'
  });
  assert.equal(prepared.artifact.language, 'und');
  assert.equal(prepared.artifact.inputMode, 'pasted_text');
  assert.equal(enginePreparation(prepared).extractor, 'pasted');
});

test('Newsjack adapter module is unchanged by extraction and still does not spawn a CLI', async () => {
  const source = await readFile('media-lens/worker/adapters/newsjack.js', 'utf8');
  assert.match(source, /never spawns the Newsjack CLI/);
  assert.doesNotMatch(source, /trafilatura/);
});

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        method,
        path,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('pinned dependency connect paths refuse without a live request', () => {
  const result = runScript({ probe_network: true });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.network_probe));
  for (const row of payload.network_probe) {
    assert.ok(row.result === 'network_refused' || row.result === 'fetch_refused', `${row.path}=${row.result}`);
  }
  const paths = new Set(payload.network_probe.map((row) => row.path));
  for (const required of [
    'socket.socket.connect',
    'socket.socket.connect_ex',
    'socket.create_connection',
    'urllib3.util.connection.create_connection',
    'http.client.HTTPConnection._create_connection',
    'ssl.SSLSocket.connect_ex',
    'trafilatura.fetch_url',
    'htmldate.utils.fetch_url',
    'courlan.network.redirection_test'
  ]) {
    assert.equal(paths.has(required), true, required);
  }
  assert.equal(result.stdout.includes(SECRET), false);
});

test('a timed-out extraction does not leave the child running or log the article', async () => {
  let pid = null;
  const logs = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'].map((method) => [method, console[method]]);
  for (const [method] of originals) {
    console[method] = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  }
  try {
    const result = await runExtractor(
      { html: `<p>${SECRET}</p>` },
      {
        gate: createExtractionGate(1),
        timeoutMs: 400,
        command: ['python3', '-c', 'import time; time.sleep(30)'],
        onSpawn(child) {
          pid = child.pid;
        }
      }
    );
    assert.equal(result.error_code, 'timeout');
    assert.equal(result.text, null);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
  assert.ok(pid);
  assert.equal(processAlive(pid), false);
  assert.equal(logs.join('\n').includes(SECRET), false);
});

test('oversized extractor output is discarded and the child is killed', async () => {
  let pid = null;
  const result = await runExtractor(
    { html: '<p>short</p>' },
    {
      gate: createExtractionGate(1),
      timeoutMs: 5000,
      maxOutputBytes: 64,
      command: ['python3', '-c', 'import sys; sys.stdout.write("Z" * 200000)'],
      onSpawn(child) {
        pid = child.pid;
      }
    }
  );
  assert.equal(result.error_code, 'output_limit');
  assert.equal(result.status, 'error');
  assert.equal(result.text, null);
  assert.equal(JSON.stringify(result).includes('ZZZZ'), false);
  assert.ok(pid);
  assert.equal(processAlive(pid), false);
});

test('input over the byte cap does not spawn a child', async () => {
  let spawned = false;
  const result = await runExtractor(
    { html: 'x'.repeat(100) },
    {
      maxInputBytes: 16,
      onSpawn() {
        spawned = true;
      }
    }
  );
  assert.equal(result.error_code, 'input_limit');
  assert.equal(result.text, null);
  assert.equal(spawned, false);
});

test('a second extraction fails closed while the only child slot is in use', async () => {
  const gate = createExtractionGate(1);
  let pid = null;
  const first = runExtractor(
    { html: '<p>one</p>' },
    {
      gate,
      timeoutMs: 5000,
      command: ['python3', '-c', 'import time; time.sleep(30)'],
      onSpawn(child) {
        pid = child.pid;
      }
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = await runExtractor(
    { html: `<p>${SECRET}</p>` },
    {
      gate,
      timeoutMs: 200,
      command: ['python3', '-c', 'import time; time.sleep(30)']
    }
  );
  assert.equal(second.error_code, 'busy');
  assert.equal(second.text, null);
  assert.equal(JSON.stringify(second).includes(SECRET), false);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The first child already exited.
  }
  const firstResult = await first;
  assert.equal(firstResult.text, null);
  assert.equal(processAlive(pid), false);
});

test('a slow extraction does not block /health and does not leave a child running', async () => {
  let pid = null;
  const server = await listen(
    createServer(loadConfig({}), {
      extractImpl(html) {
        return runExtractor(
          { html },
          {
            gate: createExtractionGate(1),
            timeoutMs: 700,
            command: ['python3', '-c', 'import time; time.sleep(30)'],
            onSpawn(child) {
              pid = child.pid;
            }
          }
        );
      }
    })
  );
  try {
    const analyzePromise = requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    const health = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.ok(Date.now() - started < 400);
    const other = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(other.status, 200);
    const analyzed = await analyzePromise;
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.body.observations.length, 0);
    assert.ok(analyzed.body.abstentions.some((entry) => entry.reason === 'engine_failure'));
    assert.equal(JSON.stringify(analyzed.body).includes('Council approves'), false);
    assert.equal(analyzed.body.engine.preparation.extractor_version, null);
  } finally {
    server.close();
  }
  assert.ok(pid);
  assert.equal(processAlive(pid), false);
});

test('Python 3.12 is the documented floor and an older interpreter does not extract', async () => {
  const [deps, installer, deploy, workflow, script] = await Promise.all([
    readFile('media-lens/worker/trafilatura/DEPS.md', 'utf8'),
    readFile('media-lens/worker/trafilatura/install.sh', 'utf8'),
    readFile('docs/media-lens-frontend-deployment.md', 'utf8'),
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('media-lens/worker/trafilatura/extract_html.py', 'utf8')
  ]);
  for (const source of [deps, installer, deploy]) {
    assert.match(source, /3\.12/);
  }
  assert.match(workflow, /python-version: '3\.12'/);
  assert.match(script, /MIN_PYTHON = \(3, 12\)/);
  assert.match(installer, /sys\.version_info >= \(3, 12\)/);
  let spawned = false;
  const result = await runExtractor(
    { html: `<p>${SECRET}</p>` },
    {
      pythonVersionText: '3.11.9',
      onSpawn() {
        spawned = true;
      }
    }
  );
  assert.equal(result.error_code, 'python_version');
  assert.equal(result.extractor_version, null);
  assert.equal(result.text, null);
  assert.equal(spawned, false);
  const prepared = await prepareFromHtml({
    html: `<p>${SECRET}</p>`,
    inputMode: 'fixture',
    extractImpl: async () => result
  });
  const graph = await analyzePrepared(prepared);
  assert.equal(graph.engine.preparation.extractor_version, null);
  assert.equal(validate(graph).valid, true);
});

test('unavailable, timeout, and busy failures do not record Trafilatura 2.2.0', async () => {
  const cases = [
    { status: 'error', error_code: 'extractor_unavailable', extractor_version: null },
    { status: 'error', error_code: 'timeout', extractor_version: null },
    { status: 'error', error_code: 'busy', extractor_version: null }
  ];
  for (const extracted of cases) {
    const prepared = await prepareFromHtml({
      html: '<html lang="en"><body><p>Visible paragraph that must not stamp a version.</p></body></html>',
      sourceUrl: 'https://fictional-daily.example/fail',
      inputMode: 'fixture',
      extractImpl: async () => extracted
    });
    const graph = await analyzePrepared(prepared);
    assert.equal(graph.engine.preparation.extraction_status, 'error', extracted.error_code);
    assert.equal(graph.engine.preparation.extractor_version, null, extracted.error_code);
    assert.equal(validate(graph).valid, true, extracted.error_code);
    assert.ok(graph.abstentions.some((entry) => entry.reason === 'engine_failure'));
  }
});

test('non-English pasted text abstains as unsupported_language and does not call Jev', async () => {
  const serverSource = await readFile('media-lens/worker/server.js', 'utf8');
  assert.match(serverSource, /live_pasted_text_disabled/);
  const prepared = await prepareFromPastedText({
    text: 'El ayuntamiento votó el martes para aprobar una obra de drenaje en el centro después de tres temporadas de inundaciones repetidas en el distrito. El alcalde dijo que las obras empezarán este año.'
  });
  assert.equal(prepared.artifact.language, 'und');
  let calls = 0;
  const graph = await analyze({
    prepared,
    config: loadConfig({}),
    jevAdapter: {
      mode: 'disabled',
      analyzeSpans: async () => {
        calls += 1;
        return { answersBySpanId: {}, failedSpanIds: [], calls: 0, failures: 0, elapsedMs: 0, modelReported: null, modelMatch: null };
      }
    },
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-18T00:00:00.000Z'
  });
  assert.equal(calls, 0);
  assert.equal(graph.observations.length, 0);
  assert.ok(graph.abstentions.some((entry) => entry.reason === 'unsupported_language'));
  assert.equal(validate(graph).valid, true);
});

test('a byline absent from the extractor text is dropped and a kept byline is not sent to Jev', async () => {
  const body = 'The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets and the public works director described the budget for the next construction season.';
  const html = `<html lang="en"><body><article><h1>Council approves drainage</h1><p class="byline">By Ada Lovelace</p><p>${body}</p></article></body></html>`;
  const dropped = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/byline',
    inputMode: 'fixture',
    extractImpl: async () => ({
      status: 'ok',
      extractor_version: TRAFILATURA_VERSION,
      detected_language: 'en',
      html_lang: 'en',
      text: `Council approves drainage\n${body}`
    })
  });
  assert.equal(dropped.spans.some((span) => span.role === 'byline_meta'), false);
  assert.equal(dropped.preparedText.includes('By Ada Lovelace'), false);
  for (const span of dropped.spans) {
    assert.equal(dropped.preparedText.slice(span.start, span.end), span.text);
  }

  const kept = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/byline',
    inputMode: 'fixture',
    extractImpl: async () => ({
      status: 'ok',
      extractor_version: TRAFILATURA_VERSION,
      detected_language: 'en',
      html_lang: 'en',
      text: `Council approves drainage\nBy Ada Lovelace\n${body}`
    })
  });
  const byline = kept.spans.find((span) => span.role === 'byline_meta');
  assert.equal(byline.text, 'By Ada Lovelace');
  assert.equal(kept.preparedText.slice(byline.start, byline.end), byline.text);
  let jevTexts = [];
  await analyze({
    prepared: kept,
    config: loadConfig({}),
    jevAdapter: {
      mode: 'disabled',
      analyzeSpans: async (spans) => {
        jevTexts = spans.map((span) => span.text);
        return { answersBySpanId: new Map(), failedSpanIds: [], calls: 0, failures: 0, elapsedMs: 0, modelReported: null, modelMatch: null };
      }
    },
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-18T00:00:00.000Z'
  });
  assert.equal(jevTexts.includes('By Ada Lovelace'), false);
  assert.ok(jevTexts.some((text) => text.includes('council voted')));
});

test('br-split paragraphs and list items are not silently dropped when other blocks still match', async () => {
  // Trafilatura splits <br> inside <p> into separate lines and prefixes <li>
  // with "- ". Exact-only matching previously kept surrounding <p>s, skipped
  // fallback, and omitted the mismatched body from preparedText.
  const html = `<!doctype html>
<html lang="en"><head><title>Safety probe</title></head>
<body>
<nav>Home About Contact Privacy</nav>
<article>
<h1>Company faces inquiry after safety report</h1>
<p>The city council opened an inquiry after residents raised alarms about factory emissions near the river.</p>
<p>Community groups demanded answers.<br>
Investigators found that the company hid safety test failures from regulators for more than two years.</p>
<p>Officials said further hearings will examine whether criminal charges are warranted under state law.</p>
<ul>
<li>Hidden lab notebooks were recovered from a locked cabinet.</li>
<li>Workers described pressure to falsify daily air-quality logs.</li>
</ul>
<p>A spokesperson declined to comment on the sealed documents cited by investigators.</p>
</article>
</body></html>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/safety-probe',
    inputMode: 'fixture'
  });
  assert.equal(prepared.extraction.status, 'ok');
  assert.match(prepared.preparedText, /Investigators found that the company hid safety test failures/);
  assert.match(prepared.preparedText, /Hidden lab notebooks were recovered/);
  assert.match(prepared.preparedText, /falsify daily air-quality logs/);
  assert.match(prepared.preparedText, /Community groups demanded answers/);
  assert.equal(prepared.preparedText.includes('Privacy'), false);
  for (const span of prepared.spans) {
    assert.equal(prepared.preparedText.slice(span.start, span.end), span.text);
  }
});

function extractedLines(lines) {
  return async () => ({
    status: 'ok',
    extractor_version: TRAFILATURA_VERSION,
    detected_language: 'en',
    html_lang: 'en',
    text: lines.join('\n')
  });
}

test('minified nested lists, multi-paragraph quotes, and list items with breaks match consecutive Trafilatura lines', async () => {
  // Trafilatura puts each nested element on its own line. The walker joins
  // them into one block without a space, so the block must equal the run.
  const html = `<!doctype html><html lang="en"><body><article><h1>Quote and lists</h1><p>The regional council published its review of the drainage program on Tuesday after months of delay.</p><blockquote><p>We cannot keep patching the same streets every spring.</p><p>The county needs a permanent drainage plan now.</p></blockquote><ul><li>Crews cleared storm drains on Elm Street.<ul><li>Two drains were fully blocked.</li><li>One culvert had collapsed.</li></ul></li><li><p>Residents filed forty claims.</p><p>Most claims involved basement flooding.</p></li><li>Inspectors will return in May.<br>A final report is due in June.</li></ul><p>The notice listed <code>Drain 4
Drain 9</code> as blocked until crews finish the work this summer.</p><p>Officials said repairs will begin once the state releases emergency funds for the county.</p></article></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/nested', inputMode: 'fixture' });
  assert.equal(prepared.extraction.status, 'ok');
  for (const phrase of [
    /permanent drainage plan now/,
    /Two drains were fully blocked/,
    /One culvert had collapsed/,
    /Most claims involved basement flooding/,
    /A final report is due in June/,
    /Drain 9/,
    /state releases emergency funds/
  ]) {
    assert.match(prepared.preparedText, phrase);
  }
  const quoted = prepared.spans.find((span) => span.role === 'quoted' && span.text.includes('permanent drainage plan'));
  assert.ok(quoted);
  assert.match(quoted.text, /same streets every spring/);
  for (const span of prepared.spans) {
    assert.equal(prepared.preparedText.slice(span.start, span.end), span.text);
  }
});

test('menu items inside the article are not kept because a body line contains their text', async () => {
  // Substring matching kept each menu <li> because a body line contained
  // "Home", "News", or "Weather". Trafilatura 2.2.0 drops a list with
  // class="menu", so no extracted line equals a menu item.
  const html = `<!doctype html><html lang="en"><body><article>
<h1>River town weighs flood repairs</h1>
<ul class="menu"><li>Home</li><li>News</li><li>Weather</li></ul>
<p>Home values near the river fell after the spring flooding, county records show.</p>
<p>News of the repair plan spread quickly among residents who lost property in the storm.</p>
<p>Weather forecasters expect another wet season, the county engineer said on Monday.</p>
</article></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/menu', inputMode: 'fixture' });
  assert.equal(prepared.extraction.status, 'ok');
  const texts = prepared.spans.map((span) => span.text);
  for (const item of ['Home', 'News', 'Weather']) {
    assert.equal(texts.includes(item), false, item);
  }
  assert.match(prepared.preparedText, /Home values near the river fell/);
  assert.match(prepared.preparedText, /another wet season/);
});

test('page numbers are not kept because a body line contains the digit', async () => {
  const lines = [
    'Flood repair costs climb',
    'Repairs to 2 bridges will cost 3 times the first estimate, the county said.',
    'Crews have 12 weeks to finish before the 2027 rainy season.'
  ];
  const html = `<article><h1>${lines[0]}</h1><p>${lines[1]}</p><p>${lines[2]}</p><ul><li>1</li><li>2</li><li>3</li><li>12</li></ul></article>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/pages',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  assert.deepEqual(
    prepared.spans.map((span) => span.text),
    lines
  );
});

test('short lines do not over-match: a block that contains a line or sits inside one is not kept', async () => {
  const lines = [
    'Council approves drainage plan',
    'More',
    'The council voted on Tuesday to approve the drainage plan after US officials inspected downtown streets.'
  ];
  const html = `<article><h1>${lines[0]}</h1><p>More stories from our newsroom this week</p><p>US</p><p>Related: Council approves drainage plan for the east side</p><p>${lines[2]}</p><p>council voted</p></article>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/short',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  assert.deepEqual(
    prepared.spans.map((span) => span.text),
    [lines[0], lines[2]]
  );
});

test('when only junk would have matched by substring, the Trafilatura-line fallback keeps the extracted body', async () => {
  // The body is in <span> elements the walker has no block for. Menu items, a
  // page number, and a fragment each appear inside an extracted line. With
  // substring matching they counted as content, skipped the fallback, and
  // replaced the article with "Home 2 council voted".
  const lines = [
    'Council approves drainage plan',
    'Home values near the river fell 2 percent after the flooding.',
    'The council voted on Tuesday to approve the drainage plan.'
  ];
  const html = `<article><span>${lines[0]}</span> <span>${lines[1]}</span> <span>${lines[2]}</span><ul class="menu"><li>Home</li><li>2</li></ul><p>council voted</p></article>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/fallback',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  assert.deepEqual(
    prepared.spans.map((span) => [span.role, span.text]),
    [
      ['headline', lines[0]],
      ['authorial', lines[1]],
      ['authorial', lines[2]]
    ]
  );
});

test('a block equal to a line plus the start of the next line is not kept', async () => {
  const lines = [
    'Council approves drainage plan',
    'The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets.',
    'Construction starts in May and should finish before the autumn storms.'
  ];
  const html = `<article><h1>${lines[0]}</h1><p>${lines[1]}</p><p>${lines[2]}</p><p>${lines[0]} The council voted</p></article>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/run-end',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  assert.deepEqual(
    prepared.spans.map((span) => span.text),
    lines
  );
});

test('list items that Trafilatura keeps do not replace a body the walker has no block for', async () => {
  // The body is in <div> paragraphs. Trafilatura keeps the unclassed tag and
  // page-number lists as "- " lines, so those <li> blocks match. List items
  // alone must not skip the fallback and reduce the article to its tags.
  const html = `<!doctype html><html lang="en"><head><title>Harbor dredging delayed again</title></head><body><article>
<div class="article-title">Harbor dredging delayed again as permit review drags on</div>
<div class="article-paragraph">The harbor authority said on Thursday that dredging of the north channel will not begin until next spring, the third delay since the project was approved.</div>
<div class="article-paragraph">State regulators are still reviewing a permit for the disposal site, and the authority cannot award a contract until that review is complete, a spokesperson said.</div>
<div class="article-paragraph">Fishing crews say the channel has grown so shallow that larger boats can only enter at high tide, cutting the number of trips they can make each week.</div>
<ul><li>Harbor</li><li>Permits</li><li>Fishing</li></ul>
<ol><li>1</li><li>2</li><li>3</li></ol>
</article></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/harbor', inputMode: 'fixture' });
  assert.equal(prepared.extraction.status, 'ok');
  assert.match(prepared.preparedText, /third delay since the project was approved/);
  assert.match(prepared.preparedText, /permit for the disposal site/);
  assert.match(prepared.preparedText, /only enter at high tide/);
});

test('invisible characters that Trafilatura removes do not stop a paragraph from matching', async () => {
  const zeroWidth = 'The pumping station failed twice in March,​ according to the county inspection report released on Monday.';
  const softHyphen = 'Engineers blamed corroded wiring in the control­room and asked for emergency repair money this week.';
  const html = `<!doctype html><html lang="en"><body><article><h1>Pump failures under review</h1><p>The regional council published its review of the drainage program on Tuesday after months of delay.</p><p>${zeroWidth}</p><p>${softHyphen}</p></article></body></html>`;
  const prepared = await prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/invisible', inputMode: 'fixture' });
  assert.equal(prepared.extraction.status, 'ok');
  assert.ok(prepared.spans.some((span) => span.text === zeroWidth));
  assert.ok(prepared.spans.some((span) => span.text === softHyphen));
});

test('only list items match after the "- " marker is removed, and other bullet characters are not markers', async () => {
  const lines = [
    'Library budget update',
    '- Grant renewed for the branch library.',
    '- Budget approved at the Tuesday session.',
    '• Subscribe for weekly budget alerts.',
    '* Sponsored: compare budget apps.'
  ];
  const html = `<article><h1>${lines[0]}</h1><ul><li>Grant renewed for the branch library.</li></ul><p>Budget approved at the Tuesday session.</p><ul class="menu"><li>Subscribe for weekly budget alerts.</li><li>Sponsored: compare budget apps.</li></ul></article>`;
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/markers',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  assert.deepEqual(
    prepared.spans.map((span) => span.text),
    ['Library budget update', 'Grant renewed for the branch library.']
  );
});

function auditList(count) {
  const items = Array.from({ length: count }, (_, i) => `Finding ${i} was recorded in the district ledger during the audit.`);
  const menu = Array.from({ length: count }, (_, i) => `<li>Finding ${i} archive link</li>`).join('');
  return {
    html: `<article><h1>Audit findings released</h1><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul><ul class="menu">${menu}</ul></article>`,
    lines: ['Audit findings released', ...items.map((item) => `- ${item}`)],
    spans: count + 1
  };
}

function interview(count) {
  // Trafilatura puts each "Q:" and "A:" label on its own line, so every
  // walked <p> is a two-line run whose first line repeats.
  const html = [];
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const question = `Question ${i} asks how the drainage budget will change next year?`;
    const answer = `Answer ${i} says the public works director expects a small increase.`;
    html.push(`<p><strong>Q:</strong><br>${question}</p><p><strong>A:</strong><br>${answer}</p>`);
    lines.push('Q:', question, 'A:', answer);
  }
  return { html: `<article>${html.join('')}</article>`, lines, spans: count * 2 };
}

async function fastestPreparationMs({ html, lines, spans }) {
  let fastest = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    const prepared = await prepareFromHtml({
      html,
      sourceUrl: 'https://fictional-daily.example/timing',
      inputMode: 'fixture',
      extractImpl: extractedLines(lines)
    });
    fastest = Math.min(fastest, performance.now() - started);
    assert.equal(prepared.spans.length, spans);
  }
  return fastest;
}

test('a large list is matched in bounded time', async () => {
  // Substring matching compared every walked block with every extracted line,
  // so 6,000 list items plus 6,000 unmatched menu items took seconds.
  const { html, lines, spans } = auditList(6000);
  const started = performance.now();
  const prepared = await prepareFromHtml({
    html,
    sourceUrl: 'https://fictional-daily.example/audit',
    inputMode: 'fixture',
    extractImpl: extractedLines(lines)
  });
  const elapsedMs = performance.now() - started;
  assert.equal(prepared.spans.length, spans);
  assert.equal(prepared.spans.some((span) => span.text.includes('archive link')), false);
  assert.ok(elapsedMs < 2000, `large list took ${Math.round(elapsedMs)} ms`);
});

test('matching time grows about linearly for large lists and repeated interview labels', async () => {
  // Eight times the input should take far less than 20 times as long. Linear
  // matching measured 6x to 10x on Node 20 and 22; the quadratic run search
  // this replaced measured about 80x on the interview input.
  for (const build of [auditList, interview]) {
    const small = await fastestPreparationMs(build(1500));
    const large = await fastestPreparationMs(build(12000));
    assert.ok(large / small < 20, `${build.name}: ${Math.round(small)} ms at 1,500 vs ${Math.round(large)} ms at 12,000`);
  }
});

test('architecture section 10.2 matches first-article Trafilatura matching', async () => {
  const doc = await readFile('docs/media-lens-live-url-v2-architecture.md', 'utf8');
  const section = doc.split('### 10.2 Preparation')[1].split('### 10.3')[0];
  assert.equal(section.includes('largest text-bearing block'), false);
  assert.match(section, /first `<article>`/);
  assert.match(section, /Trafilatura paragraph/);
  assert.match(section, /fall back to one block per Trafilatura line/);
  assert.match(section, /`<br>`-split paragraphs/);
  assert.match(section, /exactly equals one Trafilatura paragraph line or a run of consecutive Trafilatura paragraph lines/);
  assert.match(section, /Only a walked `<li>` may also match after the leading `- ` list marker/);
  assert.match(section, /only contains a line, or only appears inside one, is not a match/);
  assert.match(section, /If no content block other than a list item remains/);
  assert.match(section, /List items alone, such as a menu or page numbers that Trafilatura kept, do not prevent this fallback/);
  assert.equal(/contains a Trafilatura paragraph line|is contained in a Trafilatura paragraph line/.test(section), false);
  assert.equal(section.includes('`•`'), false);
});
