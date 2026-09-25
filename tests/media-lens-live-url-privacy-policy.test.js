import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { JEV_MAX_CONTEXT_CHARS, JEV_MAX_SPAN_CHARS, createJevAdapter } from '../media-lens/worker/adapters/jev.js';
import { redactAuditRecord } from '../media-lens/worker/audit.js';
import { sanitizeBudgetStoreRecord } from '../media-lens/worker/typesafe-budget-store.js';
import { parseArticleUrl } from '../media-lens/worker/address-policy.js';
import { analyze } from '../media-lens/worker/analyze.js';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';

const CLARITY_PRIVACY_SUMMARY =
  'We do not operate accounts, servers that receive your pasted text, or analytics that track what you analyze.';
const CLARITY_ON_DEVICE =
  'When you analyze a message, processing happens entirely in your browser using local JavaScript. Nothing is uploaded to Clarity or any third-party service for analysis.';
const MEDIA_LENS_PRIVACY_DISCLOSURE =
  'Media Lens is a separate, experimental preview for public articles, advertisements, speeches, and campaign material. It is not part of this Clarity site. A limited Jev-only Media Lens preview runs on a separate operator host, ml-jev.manipulationscore.com. It analyzes one public web page at a time, and only from a short list of hosts the operator allows. The Media Lens page sends only https addresses. The worker on the operator host also accepts http addresses sent directly to its API, under the same host list, address checks, and redirect rules. Live pasted-text analysis is off. The secondary classifier, classifier.dev, is off. Media Lens is not production-ready, and the operator can pause it at any time with a kill switch. Do not enter private messages or material you are not authorized to review. Clarity’s private analyzer remains governed by the on-device behavior described above.';

// Wording that described Media Lens before the 2026-09-21 operator preview.
// Trust pages must not keep it once the preview runs on the operator host.
const STALE_MEDIA_LENS_WORDING = [
  /unreleased fixture\/local preview/i,
  /not available on the public site/i,
  /Future Media Lens live URL/i,
  /Live URL analysis is not available/i,
  /Any future live mode/i,
  /updated privacy notice/i,
  /if later enabled/i,
  /usually your computer/i
];

const PRODUCTION_READY_CLAIM =
  /live URL is production-ready|production-ready live URL|ready for production|live URL is currently available|live URL analysis is currently available|live URL is available on (this|the public) site/i;

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : undefined;
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

test('privacy.html preserves Clarity on-device sentences and the Media Lens preview disclosure', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, new RegExp(escapeRe(CLARITY_PRIVACY_SUMMARY)));
  assert.match(html, new RegExp(escapeRe(CLARITY_ON_DEVICE)));
  assert.match(html, new RegExp(escapeRe(MEDIA_LENS_PRIVACY_DISCLOSURE)));
  assert.match(html, /Clarity is designed so your messages stay on your device\./);
});

test('privacy.html describes the operator-host preview as limited, Jev-only, and not production-ready', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /<h2>Media Lens live URL analysis<\/h2>/);
  assert.match(html, /runs on a separate operator host, ml-jev\.manipulationscore\.com/);
  assert.match(html, /one public web page at a time/);
  assert.doesNotMatch(html, /one public https page at a time/);
  assert.match(html, /The Media Lens page sends only https addresses\./);
  assert.match(html, /also accepts http addresses sent directly to its API, under the same host list, address checks, and redirect rules\./);
  assert.match(html, /short list of hosts the operator allows/);
  assert.match(html, /not production-ready/);
  assert.match(html, /pause it at any time with a kill switch/);
  assert.match(html, /It is not part of this Clarity site\./);
  assert.match(html, /This section applies only to Media Lens on the operator host\. Clarity message analysis stays on your device/);
  for (const stale of STALE_MEDIA_LENS_WORDING) {
    assert.doesNotMatch(html, stale);
  }
  assert.doesNotMatch(html, PRODUCTION_READY_CLAIM);
  assert.doesNotMatch(html, /live Media Lens processing is currently available/i);
  assert.doesNotMatch(html, /Media Lens is deployed on this site/i);
  assert.doesNotMatch(html, /Media Lens is (now )?generally available/i);
  assert.doesNotMatch(html, /\d+\s*%\s*accura/i);
  assert.doesNotMatch(html, /MEDIA_LENS_ENABLE_LIVE_URL=true/);
  assert.doesNotMatch(html, /TYPESAFE_API_KEY/);
  assert.doesNotMatch(html, /api\.typesafe\.ai/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{16,}/);
});

test('privacy.html states fixture examples are made up and coverage comparison is not live', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /Examples on the Media Lens page that are labeled as fixtures or samples are made up\./);
  assert.match(
    html,
    /Comparing how different outlets covered the same story is not live, because no approved source exists for finding other reports of the same story\./
  );
  assert.match(html, /compares coverage across outlets in live results/);
});

test('privacy.html discloses consent before sending, the network steps, what the host keeps, and sensitive-content limits', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /Before anything is sent, the page asks you to confirm that the material is public and that you are allowed to review it\./);
  // The public page must stay true while the operator host still serves an
  // earlier page build, whose consent checkbox is not re-asked per analysis.
  assert.doesNotMatch(html, /asks again for each analysis/);
  assert.match(html, /The URL is not sent until you confirm, and the operator host rejects an analysis request without that confirmation\./);
  assert.match(html, /Your browser sends the URL to the operator host inside the request body\./);
  assert.match(html, /The operator host, not your browser, requests the public page at that URL\./);
  assert.match(html, /The destination site and its content network see the operator host’s network address, not yours\./);
  assert.match(html, /The request carries no cookies from your browser\./);
  assert.match(html, /sends prepared public span text to TypeSafe AI’s Jev service/);
  assert.match(html, /one request per span, repeated up to three more times after some errors\./);
  assert.match(
    html,
    /Each request holds the page title, the kind of material \(for example, article\), the span’s id and role \(for example, quoted\), the span text \(up to 1,200 characters\), and the first 400 characters of the spans just before and after it\./
  );
  assert.match(html, /Spans marked as bylines or boilerplate are not sent, either on their own or as neighbouring text\./);
  assert.match(html, /Each request also carries Media Lens’s fixed questions and the requested Jev model name\./);
  assert.doesNotMatch(html, /up to 400 characters of the text on each side of it/);
  assert.match(html, /TypeSafe processes it under TypeSafe’s own policy\. TypeSafe does not fetch the URL, and Media Lens does not send the URL to TypeSafe\./);
  assert.match(html, /Media Lens does not keep the full article text after the analysis/);
  assert.match(html, /redacted audit lines to the host’s system log/);
  assert.match(html, /They contain only fields from a fixed list: the time, the event type, the worker mode, the input mode/);
  assert.match(html, /the abstention reason when a page could not be fetched/);
  assert.match(html, /classifier\.dev counters and state/);
  assert.match(html, /whether its host is a domain name or an IP address/);
  assert.match(
    html,
    /Audit lines do not include the full URL, the page path or query, an IP address from the URL, article text, span text, or your IP address\./
  );
  assert.match(html, /ESTIMATED TypeSafe spend record stores only the month, a count of Jev calls, an estimated token count, and whether a spend warning was issued\. It stores no text and no URLs\./);
  assert.match(html, /The operator host’s web server keeps a standard access log\./);
  assert.match(html, /request metadata such as your IP address, the time, the requested path, and browser details/);
  assert.match(html, /It does not record request bodies, so the URL you submit is not in that log\./);
  assert.match(html, /The access log is set in the host’s web server configuration, which is not part of this repository\./);
  assert.match(html, /How long the operator host keeps its system log and access log is set on that host and is not yet documented here\./);
  assert.doesNotMatch(html, /Retention would be none/);
  assert.doesNotMatch(html, /(access|system) log[^<]*\b\d+\s*(days?|weeks?|months?)\b/i);
  assert.match(html, /does not claim that TypeSafe retains nothing, deletes on request, or offers zero data retention/);
  assert.match(html, /Do not submit private messages, passwords, medical or financial records, information about children/);
  assert.match(html, /Media Lens rejects URLs that contain a username or password\./);
  assert.match(html, /Media Lens does not bypass paywalls\./);
  assert.match(
    html,
    /When it recognizes a page as paywalled, it analyzes only the visible excerpt in the page the operator host received, and prepared spans from that excerpt may be sent to TypeSafe as described above\. The result notes that the analysis is limited to the visible excerpt\./
  );
  assert.doesNotMatch(html, /paywalled are left unanalyzed/);
});

test('privacy.html data-flow details match the worker code', async () => {
  // Span and context caps quoted on the privacy page.
  assert.equal(JEV_MAX_SPAN_CHARS, 1200);
  assert.equal(JEV_MAX_CONTEXT_CHARS, 400);

  // The Jev request state carries the page kind and title, the span, and
  // neighbouring text. It has no URL field, so TypeSafe is not sent the URL.
  const jevSrc = await readFile('media-lens/worker/adapters/jev.js', 'utf8');
  const stateFn = jevSrc.slice(jevSrc.indexOf('function buildRequestState'), jevSrc.indexOf('export function isRetryableStatus'));
  assert.match(stateFn, /artifact: \{ kind: artifact\.kind, title: artifact\.title \}/);
  assert.doesNotMatch(stateFn, /url/i);

  // The worker's page request sends no cookies.
  const pinnedSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  const headersFn = pinnedSrc.slice(pinnedSrc.indexOf('function requestHeaders'), pinnedSrc.indexOf('function isIpHostname'));
  assert.match(headersFn, /User-Agent/);
  assert.doesNotMatch(headersFn, /cookie/i);

  // Audit lines drop URL, path, text, and client address fields.
  const record = redactAuditRecord({
    event: 'analyze_complete',
    mode: 'live',
    url: 'https://en.wikipedia.org/wiki/Yes?x=1',
    path: '/wiki/Yes',
    text: 'span text that must not be logged',
    span_text: 'span text that must not be logged',
    client_ip: '203.0.113.9',
    remote_addr: '203.0.113.9',
    host_key: 'wikipedia.org',
    jev_calls: 3
  });
  assert.deepEqual(Object.keys(record).sort(), ['event', 'host_key', 'jev_calls', 'mode']);

  // The ESTIMATED spend record refuses any field beyond counts.
  assert.equal(
    sanitizeBudgetStoreRecord({ version: 1, month: '2026-09', calls: 1, estimatedTokens: 1500, warnEmitted: false, url: 'x' }),
    null
  );
  assert.deepEqual(
    Object.keys(sanitizeBudgetStoreRecord({ version: 1, month: '2026-09', calls: 1, estimatedTokens: 1500, warnEmitted: false })).sort(),
    ['calls', 'estimatedTokens', 'month', 'version', 'warnEmitted']
  );
});

function preparedForJevRequestCheck({ paywallDetected = false } = {}) {
  const rows = [
    ['headline', 'Harbor Bridge Synthetic'],
    ['byline_meta', 'By A. Synthetic Reporter, staff writer'],
    ['authorial', `The harbor authority said repairs continue. ${'A'.repeat(1300)}`],
    ['boilerplate', 'Subscribe to our newsletter for daily updates and offers.'],
    ['quoted', `We expect the deck repairs to finish soon. ${'Q'.repeat(700)}`],
    ['authorial', 'Officials plan a public meeting next week to discuss the schedule.']
  ];
  let offset = 0;
  const spans = rows.map(([role, text], index) => {
    const span = {
      id: `span-${index + 1}`,
      start: offset,
      end: offset + text.length,
      text,
      paragraph_index: index,
      role,
      role_basis: 'default',
      attribution: { speaker: null, cue: null }
    };
    offset += text.length + 1;
    return span;
  });
  const url = 'https://en.wikipedia.org/wiki/Harbor_Bridge_Synthetic?ref=privacy-check';
  return {
    preparedText: spans.map((span) => span.text).join('\n'),
    textSha256: '0'.repeat(64),
    textLengthChars: offset,
    spans,
    claimCandidates: [],
    paywallDetected,
    extraction: {
      status: 'ok',
      languageScope: 'article_html',
      extractorVersion: '2.2.0',
      languageDetectorVersion: 'test',
      bodySha256: null,
      contentType: 'text/html',
      fetchStatus: '200',
      fetchedAt: null
    },
    artifact: {
      kind: 'article',
      inputMode: 'url',
      url,
      canonicalUrl: url,
      title: 'Harbor Bridge Synthetic',
      byline: 'A. Synthetic Reporter',
      publisherName: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language: 'en'
    }
  };
}

// Runs the real analyze() pipeline with a live-mode Jev adapter whose fetch
// is captured in memory. No network request is made.
async function captureJevRequests(prepared) {
  const bodies = [];
  const jevAdapter = createJevAdapter({
    mode: 'live',
    baseUrl: 'https://typesafe.invalid',
    apiKey: 'test-key-not-used',
    concurrency: 1,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: false, status: 400, headers: new Headers() };
    }
  });
  const graph = await analyze({
    prepared,
    config: loadConfig({}),
    jevAdapter,
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: null
  });
  return { bodies, graph };
}

test('privacy.html: each TypeSafe request carries exactly the fields the page lists and no URL', async () => {
  const prepared = preparedForJevRequestCheck();
  const { bodies } = await captureJevRequests(prepared);
  const eligible = prepared.spans.filter((span) => span.role !== 'boilerplate' && span.role !== 'byline_meta');
  assert.equal(bodies.length, eligible.length, 'one request per Jev-eligible span (a 400 is not retried)');

  bodies.forEach((body, index) => {
    assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']);
    assert.equal(body.model, 'jev-1.13.0');
    const { state } = body;
    assert.deepEqual(Object.keys(state).sort(), ['artifact', 'context', 'span']);
    assert.deepEqual(state.artifact, { kind: 'article', title: 'Harbor Bridge Synthetic' });
    assert.deepEqual(Object.keys(state.span).sort(), ['id', 'role', 'text']);
    assert.equal(state.span.id, eligible[index].id);
    assert.equal(state.span.role, eligible[index].role);
    assert.equal(state.span.text, eligible[index].text.slice(0, 1200));
    assert.deepEqual(Object.keys(state.context).sort(), ['after', 'before']);
    assert.equal(state.context.before, index > 0 ? eligible[index - 1].text.slice(0, 400) : null);
    assert.equal(state.context.after, index < eligible.length - 1 ? eligible[index + 1].text.slice(0, 400) : null);

    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /wikipedia|https?:\/\/|privacy-check/i, 'no URL reaches TypeSafe');
    assert.doesNotMatch(serialized, /Synthetic Reporter/, 'bylines are not sent');
    assert.doesNotMatch(serialized, /Subscribe to our newsletter/, 'boilerplate is not sent');
  });
});

test('privacy.html: a page recognized as paywalled is analyzed from its visible excerpt, not left unanalyzed', async () => {
  const { bodies, graph } = await captureJevRequests(preparedForJevRequestCheck({ paywallDetected: true }));
  assert.ok(bodies.length > 0, 'prepared spans of the visible excerpt are still sent to TypeSafe');
  assert.equal(graph.artifact.paywall_detected, true);
  const note = graph.abstentions.find((entry) => entry.reason === 'paywall');
  assert.ok(note, 'the result carries a paywall note');
  assert.match(note.message, /does not bypass paywalls, so analysis is limited to the visible excerpt/);
});

test('trust-page scheme wording matches the page and the worker URL policy', async () => {
  // The worker accepts http and https, and nothing else.
  assert.equal(parseArticleUrl('http://en.wikipedia.org/wiki/Yes').parsed.protocol, 'http:');
  assert.equal(parseArticleUrl('https://en.wikipedia.org/wiki/Yes').parsed.protocol, 'https:');
  assert.throws(() => parseArticleUrl('ftp://en.wikipedia.org/wiki/Yes'), (err) => err.code === 'BAD_SCHEME');
  // Every redirect hop is re-checked against the allowlist, and https may not
  // redirect to http.
  const fetchSrc = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  assert.match(fetchSrc, /previousScheme === 'https:' && parsed\.protocol === 'http:'/);
  assert.match(fetchSrc, /REDIRECT_DOWNGRADE/);
  assert.match(fetchSrc, /hostIsAllowlisted\(parsed\.hostname, urlAllowlist\)/);
  // The page itself refuses anything but https.
  const pageSrc = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(pageSrc, /parsedUrl\.protocol !== 'https:'/);

  const privacy = await readFile('privacy.html', 'utf8');
  const limitations = await readFile('limitations.html', 'utf8');
  const changelog = await readFile('changelog.html', 'utf8');
  for (const [name, html] of [
    ['privacy.html', privacy],
    ['limitations.html', limitations],
    ['changelog.html', changelog]
  ]) {
    assert.doesNotMatch(html, /one public https page at a time/, `${name} must not say https only`);
    assert.match(html, /sends only https addresses/, name);
    assert.match(html, /also accepts http addresses sent directly to its API/, name);
  }
});

test('privacy.html and limitations.html keep live pasted-text prohibited', async () => {
  const privacy = await readFile('privacy.html', 'utf8');
  const limitations = await readFile('limitations.html', 'utf8');
  assert.match(privacy, /Live pasted-text analysis is off\./);
  assert.match(privacy, /Private messages belong in Clarity and must not be submitted to Media Lens as a URL\./);
  assert.match(limitations, /Live pasted-text analysis remains prohibited/);
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  assert.match(serverSrc, /live_pasted_text_disabled/);
  assert.match(serverSrc, /Live pasted-text analysis is disabled/);
});

test('limitations.html and acceptable-use.html describe the operator preview without availability or accuracy claims', async () => {
  const limitations = await readFile('limitations.html', 'utf8');
  const acceptableUse = await readFile('acceptable-use.html', 'utf8');

  assert.match(limitations, /always "not checked" in this preview/);
  assert.match(limitations, /A limited Jev-only live URL preview runs on a separate operator host, ml-jev\.manipulationscore\.com\./);
  assert.match(limitations, /It is experimental and not production-ready, and the operator can pause it at any time\./);
  assert.match(limitations, /one public page at a time from a short list of hosts the operator allows/);
  assert.match(limitations, /On a page Media Lens recognizes as paywalled, only the visible excerpt is analyzed\./);
  assert.match(limitations, /TypeSafe's Jev classifier/);
  assert.match(limitations, /No accuracy claim is made for its output\./);
  assert.match(limitations, /comparing how different outlets covered the same story is not live/);
  assert.match(limitations, /Examples labeled as fixtures or samples are made up\./);
  assert.match(limitations, /Private messages still belong in Clarity\./);
  assert.doesNotMatch(limitations, PRODUCTION_READY_CLAIM);

  assert.match(acceptableUse, /experimental Media Lens preview, which runs on a separate operator host and not on this site/);
  assert.match(acceptableUse, /Submit private messages, passwords, or other non-public material to Media Lens/);
  assert.match(acceptableUse, /Use a Media Lens URL fetch to retrieve paywalled, private, internal-network, or otherwise unauthorized content/);
  assert.doesNotMatch(acceptableUse, PRODUCTION_READY_CLAIM);
  assert.doesNotMatch(acceptableUse, /live URL is currently available/i);
});

test('MEDIA_LENS_ENABLE_LIVE_URL is not true by default', () => {
  const unset = loadConfig({});
  assert.equal(unset.mode, 'fixture');
  assert.equal(unset.liveEnabled, false);
  assert.equal(unset.liveUrlEnabled, false);

  const liveWithoutUrlFlag = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'not-a-real-key'
  });
  assert.equal(liveWithoutUrlFlag.liveEnabled, true);
  assert.equal(liveWithoutUrlFlag.liveUrlEnabled, false);

  const truthyButNotExact = loadConfig({ MEDIA_LENS_ENABLE_LIVE_URL: 'TRUE' });
  assert.equal(truthyButNotExact.liveUrlEnabled, false);
});

const TYPESAFE_NON_CLAIMS =
  'Media Lens does not claim that TypeSafe AI will not retain, delete, train on, or otherwise use submitted inputs. Those practices are governed by TypeSafe\u2019s applicable policy or written agreement. Media Lens makes no ZDR, deletion, or no-training claim unless a written agreement is attached to the release packet.';
const JEV_ONLY_SCOPE =
  'The only production provider in scope for live URL mode is the pinned TypeSafe Jev integration. classifier.dev remains disabled, evaluation-only, and is not a fallback, second model, cascade, or production dependency.';

test('privacy.html records TypeSafe non-claims, Jev-only scope, and KEEP_EVALUATION_ONLY for the operator preview', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, new RegExp(escapeRe(TYPESAFE_NON_CLAIMS)));
  assert.match(html, new RegExp(escapeRe(JEV_ONLY_SCOPE)));
  assert.match(html, /Live pasted-text analysis stays disabled/);
  assert.match(html, /classifier\.dev remains off \/ KEEP_EVALUATION_ONLY/);
  assert.match(html, /experimental and not production-ready\. It is not deployed on the public Clarity site\. It is not generally available\./);
  assert.match(html, /KEEP_EVALUATION_ONLY/);
  assert.doesNotMatch(html, /MEDIA_LENS_ENABLE_LIVE=true/);
  assert.doesNotMatch(html, /MEDIA_LENS_ENABLE_LIVE_URL=true/);
  assert.doesNotMatch(html, /MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true/);
  assert.match(html, /does not claim that classifier\.dev is part of the live path/);
  assert.doesNotMatch(html, /we delete your article text from TypeSafe/i);
  assert.doesNotMatch(html, /zero data retention is enabled/i);
  const classifierPrivacy = await readFile('docs/media-lens-classifier-dev-privacy.md', 'utf8');
  assert.match(classifierPrivacy, /KEEP_EVALUATION_ONLY/);
  assert.match(classifierPrivacy, /off by default/);
});

test('privacy.html lists forbidden Media Lens public claims for the operator preview', async () => {
  const html = await readFile('privacy.html', 'utf8');
  const required = [
    'is production-ready',
    'is generally available',
    'detects manipulation with guaranteed accuracy',
    'fact-checks claims',
    'identifies manipulative people, outlets, or political actors',
    'compares coverage across outlets in live results',
    'provides anonymous or zero-retention processing',
    'guarantees no training or third-party processing',
    'is a diagnosis, safety assessment, or definitive credibility judgment'
  ];
  for (const claim of required) {
    assert.match(html, new RegExp(escapeRe(claim)));
  }
  assert.match(html, /does not claim TypeSafe ZDR/);
  assert.match(html, /detected an attack on a named outlet or person/);
  assert.doesNotMatch(html, PRODUCTION_READY_CLAIM);
});

test('trust pages no longer describe Media Lens as unreleased, fixture-only, or not deployed', async () => {
  for (const page of ['privacy.html', 'limitations.html', 'acceptable-use.html', 'methodology.html']) {
    const html = await readFile(page, 'utf8');
    for (const stale of STALE_MEDIA_LENS_WORDING) {
      assert.doesNotMatch(html, stale, `${page} still has stale Media Lens wording ${stale}`);
    }
    assert.doesNotMatch(html, /unreleased[^<]*Media Lens|Media Lens[^<]{0,40}unreleased/i, `${page} still calls Media Lens unreleased`);
    assert.doesNotMatch(html, PRODUCTION_READY_CLAIM);
  }
});

test('live pasted-text remains rejected even when an operator sets MEDIA_LENS_ENABLE_LIVE_URL=true', async () => {
  const publicPastedText = Array.from(
    { length: 6 },
    (_, i) => `Sentence number ${i + 1} in this article about a policy debate.`
  ).join('\n\n');

  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_PORT: '0'
  });
  assert.equal(config.liveUrlEnabled, true);

  const server = createServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: publicPastedText }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'live_pasted_text_disabled');
  } finally {
    server.close();
  }
});
