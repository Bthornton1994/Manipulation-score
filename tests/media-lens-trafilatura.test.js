import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from '../media-lens/worker/analyze.js';
import { createJevAdapter } from '../media-lens/worker/adapters/jev.js';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { enginePreparation, prepareFromHtml, prepareFromPastedText } from '../media-lens/worker/prepare.js';
import {
  PY3LANGID_VERSION,
  TRAFILATURA_VERSION,
  extractLocalArticle,
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
  assert.doesNotMatch(script, /fetch_url\(/);
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

test('extractor reads HTML already in hand and does not need a URL', () => {
  const html = `<html lang="en"><head><link rel="canonical" href="https://example.invalid/story"></head><body><article><h1>Council vote</h1><p>The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets.</p></article></body></html>`;
  const result = extractLocalArticle(html);
  assert.equal(result.status, 'ok');
  assert.equal(result.extractor_version, TRAFILATURA_VERSION);
  assert.equal(result.language_detector_version, PY3LANGID_VERSION);
  assert.match(result.text, /council voted on Tuesday/);
  assert.doesNotMatch(result.text, /example\.invalid/);
});

test('navigation and sidebar boilerplate stay out of prepared spans while quoted body text remains an exact slice', () => {
  const prepared = prepareFromHtml({ html: NAV_HTML, sourceUrl: 'https://fictional-daily.example/nav', inputMode: 'fixture' });
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
  const byline = prepared.spans.find((span) => span.role === 'byline_meta');
  assert.equal(byline.text, 'By Ada Lovelace');
});

test('preparation retains the body hash, extractor version, and metadata without the raw HTML', () => {
  const html = `<!doctype html><html lang="en"><head>
    <meta property="og:title" content="Some headline" />
    <meta property="og:site_name" content="Fictional Daily" />
  </head><body><article><h1>Some headline</h1><p>Enough authorial text to be analyzable in this test case for the drainage vote.</p></article><!-- ${COMMENT} --></body></html>`;
  const prepared = prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/articles/x', inputMode: 'fixture' });
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

test('missing metadata can be filled from extraction without labeling the publisher as the hostname', () => {
  const html = `<html lang="en"><body><h1>Neighborhood cleanup</h1><p>Volunteers will meet at the riverfront trail on Saturday morning to collect litter and sort recycling.</p></body></html>`;
  const prepared = prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/cleanup', inputMode: 'fixture' });
  assert.equal(prepared.artifact.title, 'Neighborhood cleanup');
  assert.equal(prepared.artifact.publisherName, null);
  assert.equal(prepared.artifact.byline, null);
});

test('non-English and disagreed language labels stay und and do not produce a finding', async () => {
  const spanish = `<html lang="es"><body><article><h1>El consejo aprueba el drenaje</h1><p>El ayuntamiento votó el martes para aprobar una obra de drenaje en el centro después de tres temporadas de inundaciones repetidas en el distrito.</p><p>El alcalde dijo que las obras empezarán este año y que el presupuesto ya está reservado para los vecinos.</p></article></body></html>`;
  const disagreed = spanish.replace('lang="es"', 'lang="en"');
  for (const html of [spanish, disagreed]) {
    const prepared = prepareFromHtml({ html, sourceUrl: 'https://fictional-daily.example/es', inputMode: 'fixture' });
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
    const prepared = prepareFromHtml({ html: item.html, sourceUrl: 'https://fictional-daily.example/bad', inputMode: 'fixture' });
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
  const prepared = prepareFromHtml({
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
  const prepared = prepareFromHtml({
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

test('preparation does not log the article text', () => {
  const logs = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'].map((method) => [method, console[method]]);
  for (const [method] of originals) {
    console[method] = (...args) => logs.push(args.map((arg) => String(arg)).join(' '));
  }
  try {
    const prepared = prepareFromHtml({ html: NAV_HTML, sourceUrl: 'https://fictional-daily.example/nav', inputMode: 'fixture' });
    assert.match(prepared.preparedText, /council voted/);
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
  const joined = logs.join('\n');
  assert.equal(joined.includes(SECRET), false);
  assert.equal(joined.includes('council voted on Tuesday'), false);
});

test('pasted text is not labeled English when detection disagrees', () => {
  const prepared = prepareFromPastedText({
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
