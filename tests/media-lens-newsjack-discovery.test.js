import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NEWSJACK_CAPTURE_CONTRACT,
  NEWSJACK_CAPTURE_MAX_TEXT_BYTES,
  canonicalCaptureId,
  checkNewsjackQuery,
  validateNewsjackCapture
} from '../media-lens/schema/newsjack-capture.js';
import { validateStoryDiscovery } from '../media-lens/schema/story-discovery.js';
import { projectCapture } from '../media-lens/tools/newsjack-raw.js';
import {
  NEWSJACK_CLUSTER_BASIS,
  NEWSJACK_MEMBER_REJECTIONS,
  NEWSJACK_ORIGIN_NOTE,
  NEWSJACK_SOURCE_KINDS,
  NON_PUBLIC_HOST_SUFFIXES,
  captureToStoryDiscovery,
  classifySourceUrl,
  outletText,
  parseProviderTimestamp
} from '../media-lens/worker/discovery/newsjack-discovery.js';
import { NEWSJACK_PIN, pinnedBinarySha256 } from '../media-lens/worker/discovery/newsjack-pin.js';
import {
  IMPLEMENTED_SEARCH_PROVIDER_MODES,
  MEDIALYST_NOT_IMPLEMENTED,
  PLANNED_SEARCH_PROVIDER_MODES,
  SEARCH_PROVIDER_MODE_STATUS,
  SEARCH_PROVIDER_NOT_IMPLEMENTED,
  createHostWebSearchProvider,
  createMedialystSearchProvider,
  createRssAtomSearchProvider,
  createSearchProvider
} from '../media-lens/worker/discovery/search-provider.js';
import { FIXTURE_REQUEST, buildFixtureCapture, raw, rawText, testPin } from './helpers/newsjack-fixtures.js';

const NOW = Date.parse('2026-09-26T00:00:00.000Z');
const FARE_CLUSTER = '26027af283a9b76d';
const STUDY_CLUSTER = 'b1086c347b8d1334';
const RIDERS_CLUSTER = '8139e0b65e6da336';
const FAKE_HASH = 'a'.repeat(64);

function withId(capture) {
  capture.capture_id = canonicalCaptureId(capture);
  return capture;
}

function mutated(fn) {
  const capture = buildFixtureCapture();
  fn(capture);
  return withId(capture);
}

function codes(result) {
  return result.errors.map((error) => error.code);
}

function mockCapture({ now = Date.parse('2026-09-25T18:00:01.000Z'), signalsNull = false } = {}) {
  const candidates = raw('raw-detector-mock-real.json');
  const clustered = raw('raw-cluster-mock-real.json');
  if (signalsNull) {
    candidates.signals = null;
    candidates.diagnostics.total_scored_signals = 0;
    candidates.diagnostics.total_emitted_signals = 0;
    clustered.signals = [];
    clustered.clustering.input_signal_count = 0;
    clustered.clustering.cluster_count = 0;
    clustered.clustering.representative_count = 0;
  }
  const at = (offset) => new Date(now + offset).toISOString();
  const step = (name, a, b) => ({ step: name, started_at: at(a), exited_at: at(b), exit_code: 0, timed_out: false, stdout_bytes: 10, stderr_bytes: 0 });
  return projectCapture({
    request: FIXTURE_REQUEST,
    pin: testPin(FAKE_HASH),
    binarySha256: FAKE_HASH,
    mode: 'mock',
    steps: [step('version', -1100, -1050), step('detector_run', -1000, -500), step('cluster', -400, -300)],
    candidates,
    clustered
  });
}

test('the committed capture example is exactly what projectCapture builds from the raw fixtures', () => {
  const committed = JSON.parse(rawText('capture-fixture.json'));
  const rebuilt = buildFixtureCapture();
  assert.deepEqual(committed, rebuilt);
  assert.equal(committed.contract, NEWSJACK_CAPTURE_CONTRACT);
  assert.equal(committed.capture_id, canonicalCaptureId(committed));
  assert.deepEqual(validateNewsjackCapture(committed), { ok: true, errors: [] });
  assert.equal(committed.newsjack.commit, NEWSJACK_PIN.commit);
  assert.equal(committed.newsjack.binary_sha256, null);
});

test('a fixture capture converts to labeled, uncertain story-discovery.v1 without inventing data', () => {
  const document = captureToStoryDiscovery(buildFixtureCapture(), { now: NOW });
  assert.deepEqual(validateStoryDiscovery(document), { ok: true, errors: [] });
  assert.equal(document.status, 'ok');
  assert.equal(document.data_origin, 'fixture');
  assert.equal(document.fixture_labeled, true);
  // retrieved_at is the runner's own observation of the detector exit: an
  // upper bound on when every item was fetched. Newsjack has no per-item time.
  assert.equal(document.retrieved_at, '2026-09-25T18:00:03.410Z');
  assert.equal(document.retrieved_at_basis, 'runner_observed_detector_exit_upper_bound');
  assert.deepEqual(document.window, { start: '2026-09-24T18:00:03.410Z', end: '2026-09-25T18:00:03.410Z', hours: 24 });
  assert.deepEqual(document.provenance.retrieval_interval, { not_before: '2026-09-25T18:00:00.052Z', not_after: '2026-09-25T18:00:03.410Z' });
  assert.equal(document.provenance.commit, NEWSJACK_PIN.commit);
  assert.equal(document.provenance.binary_check, 'fixture_unhashed');
  assert.equal(document.provenance.clusters_without_members, 1);
  assert.equal(document.provenance.provider_selection.evidence_truncated, 2);
  assert.equal(document.privacy.article_pages_fetched, false);
  assert.equal(document.privacy.provider_article_pages_fetched, 'unknown_agent_retrieval');

  assert.deepEqual(document.clusters.map((cluster) => cluster.cluster_id), [FARE_CLUSTER, STUDY_CLUSTER]);
  const fare = document.clusters[0];
  assert.equal(fare.cluster_basis, NEWSJACK_CLUSTER_BASIS);
  assert.deepEqual(fare.members.map((member) => [member.outlet, member.relation, member.published_at]), [
    ['Fictional Daily', 'same_story', '2026-09-25T12:00:00.000Z'],
    ['Harbor Times', 'same_story', '2026-09-25T09:15:00.000Z'],
    ['PR Newswire', 'syndicated', '2026-09-25T10:00:00.000Z'],
    ['Valley Ledger', 'same_story', '2026-09-25T12:30:00.000Z']
  ]);
  for (const cluster of document.clusters) {
    assert.deepEqual(cluster.independent_reporting, []);
    assert.equal(cluster.independent_outlet_count, 0);
    assert.equal(cluster.coverage_gap, null);
    assert.deepEqual(cluster.frames, []);
    for (const member of cluster.members) {
      assert.equal(member.independent_reporting, false);
      assert.equal(member.retrieved_at, document.retrieved_at);
      assert.equal(member.published_at_basis, 'provider_reported_via_newsjack_unverified');
    }
  }
});

test('every dropped evidence item is counted under its own reason and listed without a URL', () => {
  const document = captureToStoryDiscovery(buildFixtureCapture(), { now: NOW });
  const row = document.sources_checked.find((entry) => entry.source_id === 'newsjack:news_search');
  assert.equal(row.outcome, 'partial');
  assert.equal(row.error, 'timeout');
  assert.equal(row.item_count, 5);
  const expected = {
    incomplete: 1,
    non_https_url: 1,
    non_public_url: 1,
    duplicate_url: 1,
    title_from_excerpt: 1,
    source_kind_excluded: 0,
    published_at_missing: 1,
    published_at_date_only: 1,
    published_at_precision: 1,
    published_at_unparseable: 0,
    published_at_rolled: 1,
    published_at_after_retrieval: 1,
    outside_window: 1
  };
  assert.deepEqual(Object.keys(expected).sort(), [...NEWSJACK_MEMBER_REJECTIONS].sort());
  for (const [reason, count] of Object.entries(expected)) assert.equal(row[`rejected_${reason}`], count, reason);
  assert.equal(row.rejected_total, 11);
  assert.equal(row.rejected_members.length, 11);
  for (const entry of row.rejected_members) {
    assert.deepEqual(Object.keys(entry).sort(), ['cluster_id', 'newsjack_signal_id', 'outlet', 'reason']);
  }
  assert.ok(!JSON.stringify(row.rejected_members).includes('://'));
  assert.ok(row.rejected_members.some((entry) => entry.cluster_id === RIDERS_CLUSTER));
});

test('origin evidence is carried only as unverified agent claims and never changes membership', () => {
  const withOrigin = captureToStoryDiscovery(buildFixtureCapture(), { now: NOW });
  const withoutOrigin = captureToStoryDiscovery(buildFixtureCapture({ withOrigin: false }), { now: NOW });
  const strip = (document) => document.clusters.map((cluster) => ({ id: cluster.cluster_id, members: cluster.members }));
  assert.deepEqual(strip(withOrigin), strip(withoutOrigin));
  assert.equal(withoutOrigin.privacy.provider_article_pages_fetched, false);
  assert.equal(withoutOrigin.clusters[0].origin_claims, undefined);

  const [claim] = withOrigin.clusters[0].origin_claims;
  assert.equal(claim.authored_by, 'ai_agent_via_story_origin_skill');
  assert.equal(claim.verification, 'unverified');
  assert.equal(claim.note, NEWSJACK_ORIGIN_NOTE);
  assert.equal(claim.same_story_assessment, 'same_story');
  assert.equal(claim.first_public_at, '2026-09-25T09:15:00.000Z');
  assert.equal(claim.freshness_status, 'fresh');
  assert.equal(claim.confidence, null, 'an out-of-range confidence is dropped, not kept');
  // The search-results URL (it carries query terms) and the http URL are withheld.
  assert.deepEqual(claim.timestamp_evidence.map((entry) => new URL(entry.url).hostname), ['harbor-times.example', 'valley-ledger.example']);
  assert.deepEqual(claim.withheld, { urls: 2, invalid_values: 1, timestamp_evidence_truncated: 0 });
  const [studyClaim] = withOrigin.clusters[1].origin_claims;
  assert.equal(studyClaim.freshness_status, 'stale');
  assert.equal(studyClaim.first_public_at, null, 'a date-only agent time is not turned into midnight');
});

test('client profile data, excerpts, authors, raw error text, and agent prose never reach the capture or document', () => {
  const capture = buildFixtureCapture();
  const document = captureToStoryDiscovery(capture, { now: NOW });
  const serialized = JSON.stringify(capture) + JSON.stringify(document);
  for (const marker of ['SENTINEL', 'token=', 'medialyst.ai', 'news.google', 'Client.Timeout', '"profile"', '"excerpt"', '"author"', '"rationale"', '"engagement"', '"metadata"', '"source_errors"']) {
    assert.ok(!serialized.includes(marker), `must not contain ${marker}`);
  }
  // The raw fixtures really do contain those values; the projection drops them.
  const rawText = JSON.stringify(raw('raw-detector.json')) + JSON.stringify(raw('raw-origin.json'));
  for (const marker of ['SENTINEL-EXCERPT', 'SENTINEL-AUTHOR', 'SENTINEL-METADATA', 'SENTINEL-TOKEN', 'SENTINEL-RATIONALE']) {
    assert.ok(rawText.includes(marker), `fixture should plant ${marker}`);
  }
});

test('the capture validator is strict at every level', () => {
  assert.deepEqual(codes(validateNewsjackCapture(null)), ['capture_not_object']);
  assert.deepEqual(codes(validateNewsjackCapture({ contract: 'other' })), ['contract_mismatch']);
  const cases = [
    ['unknown_field', (c) => (c.profile = { company: 'Acme' })],
    ['unknown_field', (c) => (c.signals[0].evidence[0].excerpt = 'x')],
    ['unknown_field', (c) => (c.signals[0].evidence[0].author = 'x')],
    ['unknown_field', (c) => (c.signals[0].story_origin = {})],
    ['unknown_field', (c) => (c.origin.claims[0].rationale = 'x')],
    ['missing_field', (c) => delete c.monitor.generated_at],
    ['pin_mismatch', (c) => (c.newsjack.version = 'v0.1.20')],
    ['pin_mismatch', (c) => (c.newsjack.commit = '092d882fc69912622f620c50eb493afe625f99dc')],
    ['binary_hash_unexpected', (c) => (c.newsjack.binary_sha256 = FAKE_HASH)],
    ['binary_hash_unrecorded', (c) => (c.runner.mode = 'mock')],
    ['process_incomplete', (c) => (c.process.steps[1].exit_code = 1)],
    ['process_incomplete', (c) => (c.process.steps[2].timed_out = true)],
    ['process_order_invalid', (c) => c.process.steps.reverse()],
    ['process_order_invalid', (c) => c.process.steps.pop()],
    ['time_invalid', (c) => (c.process.steps[1].exited_at = '2026-09-25T18:00:03Z')],
    ['run_time_inconsistent', (c) => (c.monitor.generated_at = '2026-09-25T17:00:00Z')],
    ['max_age_invalid', (c) => (c.request.max_age_hours = 72)],
    ['query_policy_violation', (c) => (c.request.query = 'person@example.com')],
    ['request_sources_invalid', (c) => (c.request.sources = ['news_search', 'reddit'])],
    ['selection_invalid', (c) => (c.selection.total_emitted_signals = 9)],
    ['clustering_inconsistent', (c) => c.clustering.groups.pop()],
    ['clustering_inconsistent', (c) => (c.clustering.title_overlap = 0.3)],
    ['source_status_invalid', (c) => (c.sources.news_search.status = 'great')],
    ['error_class_invalid', (c) => (c.sources.news_search.error_class = 'Get https://x/?token=1')],
    ['evidence_invalid', (c) => (c.signals[0].evidence[0].source = 'rss')],
    ['origin_invalid', (c) => (c.origin.claims[0].original_url = 'https://news.google.example/search?q=acme')],
    ['origin_invalid', (c) => (c.origin.claims[0].cluster_id = RIDERS_CLUSTER.replace('8', '9'))],
    ['origin_invalid', (c) => (c.origin.claims[0].freshness_status = 'verified')],
    ['origin_invalid', (c) => (c.request.origin_findings_sha256 = null)]
  ];
  for (const [code, fn] of cases) {
    const result = validateNewsjackCapture(mutated(fn));
    assert.equal(result.ok, false, code);
    assert.ok(codes(result).includes(code), `${code}: got ${codes(result).join(',')}`);
  }
  const tampered = buildFixtureCapture();
  tampered.signals[0].evidence[0].title = 'Changed after projection';
  assert.ok(codes(validateNewsjackCapture(tampered)).includes('capture_id_mismatch'));
});

test('the query policy refuses contact details, identifiers, URLs, and flags', () => {
  assert.deepEqual(checkNewsjackQuery('  transit   fare vote '), { ok: true, query: 'transit fare vote' });
  for (const query of ['ab', 'x'.repeat(121), 'a b c d e f g h i j k l m', 'jane@example.com', 'https://acme.example', 'www.acme.example', 'account 1234567', '--profile=/etc/x', 'fare\u0000vote', 'fare\u200bvote', 42, null]) {
    assert.equal(checkNewsjackQuery(query).ok, false, String(query));
  }
});

test('provider timestamps are parsed strictly and never rolled over or filled in', () => {
  const table = [
    ['2026-09-25T12:00:00Z', '2026-09-25T12:00:00.000Z', null],
    ['2026-09-25T09:15:00+00:00', '2026-09-25T09:15:00.000Z', null],
    ['2026-09-25T08:30:00-04:00', '2026-09-25T12:30:00.000Z', null],
    ['2026-09-25T14:05:00.250Z', '2026-09-25T14:05:00.250Z', null],
    ['2026-09-25T11:42:17.123456789Z', null, 'precision'],
    ['2026-09-25', null, 'date_only'],
    ['2026-02-30T12:00:00Z', null, 'rolled'],
    ['2026-09-25T24:00:00Z', null, 'unparseable'],
    ['2026-09-25T12:00:00+25:00', null, 'unparseable'],
    ['3 hours ago', null, 'unparseable'],
    ['Thu, 25 Sep 2026 12:00:00 GMT', null, 'unparseable'],
    [null, null, 'missing'],
    ['', null, 'missing'],
    [12345, null, 'unparseable']
  ];
  for (const [input, value, reason] of table) assert.deepEqual(parseProviderTimestamp(input), { value, reason }, String(input));
});

test('outlet names must be readable text, not URLs, paths, or invisible characters', () => {
  assert.equal(outletText(' Harbor\u200b  Times '), 'Harbor Times');
  for (const value of ['https://fictional-daily.example', '//cdn.example/x', 'mailto:a@b.example', '/var/feeds/local.xml', '~/feeds/x.xml', 'C:\\feeds\\x.xml', '\u200b', '---', null]) {
    assert.equal(outletText(value), '', String(value));
  }
});

test('a real mock capture converts to empty because mock dates carry no time', () => {
  const capture = mockCapture();
  assert.deepEqual(validateNewsjackCapture(capture, { pin: testPin(FAKE_HASH) }), { ok: true, errors: [] });
  const document = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-25T18:00:02.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(document.status, 'empty');
  assert.equal(document.reason, 'no_accepted_members');
  assert.equal(document.provenance.binary_check, 'matched');
  assert.equal(document.sources_checked[0].rejected_published_at_date_only, 1);
  assert.match(document.message, /synthetic data from a pinned binary, not live coverage/);
  assert.deepEqual(validateStoryDiscovery(document), { ok: true, errors: [] });

  const empty = mockCapture({ signalsNull: true });
  const emptyDocument = captureToStoryDiscovery(empty, { now: Date.parse('2026-09-25T18:00:02.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(emptyDocument.status, 'empty');
  assert.deepEqual(empty.signals, []);
});

test('mock captures must come from a recorded binary, be recent, and not come from the future', () => {
  const capture = mockCapture();
  const unrecorded = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-25T18:00:02.000Z') });
  assert.equal(unrecorded.status, 'abstain');
  assert.equal(unrecorded.sources_checked[0].error, 'binary_hash_unrecorded');
  const stale = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-28T00:00:00.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(stale.reason, 'newsjack_capture_stale');
  const future = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-25T17:00:00.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(future.sources_checked[0].error, 'capture_from_future');
});

test('live captures abstain: there is no approved news-search transport', () => {
  const capture = mockCapture();
  capture.runner.mode = 'live';
  withId(capture);
  const document = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-25T18:00:02.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(document.status, 'abstain');
  assert.equal(document.reason, 'newsjack_live_capture_not_supported');
  assert.equal(document.sources_checked[0].error, 'no_approved_transport');
  const later = captureToStoryDiscovery(capture, {
    now: Date.parse('2026-09-25T18:00:02.000Z'),
    pin: testPin(FAKE_HASH),
    searchProviderStatus: { ...SEARCH_PROVIDER_MODE_STATUS, medialyst: 'implemented' }
  });
  assert.equal(later.status, 'abstain', 'even an approved transport needs a separate reviewed change before live labels exist');
  assert.equal(later.sources_checked[0].error, 'newsjack_live_capture_not_supported');
});

test('the converter reads text safely and never throws on data', () => {
  assert.throws(() => captureToStoryDiscovery(buildFixtureCapture(), {}), TypeError);
  assert.equal(captureToStoryDiscovery(JSON.stringify(buildFixtureCapture()), { now: NOW }).status, 'ok');
  assert.equal(captureToStoryDiscovery('{"contract": ', { now: NOW }).sources_checked[0].error, 'capture_json_invalid');
  assert.equal(captureToStoryDiscovery('x'.repeat(NEWSJACK_CAPTURE_MAX_TEXT_BYTES + 1), { now: NOW }).sources_checked[0].error, 'capture_too_large');
  for (const value of [null, [], 7, 'null', '[]', { contract: NEWSJACK_CAPTURE_CONTRACT }, { contract: NEWSJACK_CAPTURE_CONTRACT, signals: 'x' }]) {
    const document = captureToStoryDiscovery(value, { now: NOW });
    assert.equal(document.status, 'abstain', JSON.stringify(value));
    assert.equal(validateStoryDiscovery(document).ok, true);
  }
  // Randomly corrupted captures abstain instead of throwing.
  const base = buildFixtureCapture();
  const paths = [['signals', 0, 'evidence', 0, 'url'], ['clustering', 'groups', 0, 'signal_ids'], ['sources', 'news_search'], ['origin', 'claims', 0, 'timestamp_evidence'], ['process', 'steps', 1]];
  for (const path of paths) {
    // Values the field's own type allows (a string url, an empty evidence
    // list) are handled per member, so only type-invalid junk is used here.
    const junkValues = [null, 5, {}];
    if (!path.includes('timestamp_evidence')) junkValues.push([]);
    if (!path.includes('url')) junkValues.push('x');
    for (const junk of junkValues) {
      const capture = structuredClone(base);
      let cursor = capture;
      for (const key of path.slice(0, -1)) cursor = cursor[key];
      cursor[path[path.length - 1]] = junk;
      withId(capture);
      const document = captureToStoryDiscovery(capture, { now: NOW });
      assert.equal(document.status, 'abstain', `${path.join('.')}=${JSON.stringify(junk)}`);
    }
  }
});

test('only news_search evidence can become a member; other kinds are counted as excluded', () => {
  const capture = mutated((c) => {
    c.signals[3].evidence[0].source = 'reddit';
  });
  assert.equal(validateNewsjackCapture(capture).ok, true);
  const document = captureToStoryDiscovery(capture, { now: NOW });
  const reddit = document.sources_checked.find((row) => row.source_id === 'newsjack:reddit');
  assert.equal(reddit.rejected_source_kind_excluded, 1);
  assert.equal(reddit.member_eligible, false);
  assert.equal(reddit.rejected_members[0].reason, 'source_kind_excluded:reddit');
  assert.deepEqual(Object.keys(NEWSJACK_SOURCE_KINDS).filter((kind) => NEWSJACK_SOURCE_KINDS[kind].member_eligible), ['news_search']);
  assert.equal(NEWSJACK_SOURCE_KINDS.news_search.live_search_provider_mode, 'medialyst');
});

test('the story-discovery validator enforces Newsjack invariants and never throws', () => {
  const good = captureToStoryDiscovery(buildFixtureCapture(), { now: NOW });
  const broken = [
    ['newsjack_independence', (d) => (d.clusters[0].members[0].independent_reporting = true)],
    ['newsjack_independence', (d) => (d.clusters[0].independent_outlet_count = 1)],
    ['newsjack_retrieved_at', (d) => (d.clusters[0].members[0].retrieved_at = '2026-09-25T18:00:04.000Z')],
    ['newsjack_origin_label', (d) => (d.clusters[0].origin_claims[0].verification = 'verified')],
    ['newsjack_window', (d) => (d.window.hours = 72)],
    ['retrieved_at_format', (d) => (d.clusters[0].members[0].retrieved_at = '2026-09-25T18:00:03Z')]
  ];
  for (const [code, fn] of broken) {
    const document = structuredClone(good);
    fn(document);
    assert.ok(validateStoryDiscovery(document).errors.includes(code), code);
  }
  for (const value of [null, [], 'x', { contract: 'story-discovery.v1', clusters: 'x' }, { contract: 'story-discovery.v1', clusters: [null, { members: 'x' }] }, { clusters: [{ members: [null] }] }]) {
    assert.equal(validateStoryDiscovery(value).ok, false, JSON.stringify(value));
  }
});

test('metadata-style and private or reserved addresses never become canonical source links', () => {
  const unsafe = [
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://instance-data.ec2.internal/latest/',
    'https://metadata/computeMetadata',
    'https://10.0.0.5/story',
    'https://192.168.1.10/story',
    'https://[fd00::1]/story',
    'https://[::ffff:127.0.0.1]/story',
    'https://0x7f.0.0.1/story',
    'https://localhost/story',
    'https://printer.home.arpa/story',
    'https://newsroom.corp/story',
    'https://staging.test/story',
    'javascript:alert(1)',
    'data:text/html,hi'
  ];
  for (const url of unsafe) {
    assert.equal(classifySourceUrl(url).url, null, url);
    assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  }
  assert.equal(classifySourceUrl('http://fictional-daily.example/a').reason, 'non_https_url');
  assert.equal(classifySourceUrl('https://fictional-daily.example/a').url, 'https://fictional-daily.example/a');
});

test('every non-public suffix has an explicit refused example', () => {
  const examples = [
    'https://instance-data.ec2.internal/', 'https://1.0.0.127.in-addr.arpa/', 'https://printer.home.arpa/', 'https://box.localdomain/',
    'https://nas.lan/', 'https://wiki.intranet/', 'https://mail.corp/', 'https://db.private/', 'https://router.home/',
    'https://kubernetes.default.svc/', 'https://x.alt/', 'https://site.test/', 'https://site.invalid/', 'https://abc.onion/',
    'https://vault.service.consul/', 'https://kubernetes.default/', 'https://169.254.169.254.nip.io/', 'https://127.0.0.1.sslip.io/',
    'https://10.0.0.1.xip.io/', 'https://app.localtest.me/', 'https://app.lvh.me/', 'https://10.0.0.1.traefik.me/',
    'https://x.backname.io/', 'https://x.1u.ms/', 'https://x.rbndr.us/', 'https://x.vcap.me/', 'https://x.local.gd/',
    'https://x.localhost.direct/', 'https://metadata.tencentyun.com/latest/meta-data/'
  ];
  for (const url of examples) assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  const covered = (suffix) => examples.some((url) => {
    const host = new URL(url).hostname;
    return host === suffix.slice(1) || host.endsWith(suffix);
  });
  assert.deepEqual(NON_PUBLIC_HOST_SUFFIXES.filter((suffix) => !covered(suffix)), []);
  assert.equal(classifySourceUrl('https://fictional-daily.example/a').reason, null);
});

test('only fixture search is implemented; host web search, RSS/Atom, and Medialyst fail with NOT_IMPLEMENTED', async () => {
  assert.deepEqual([...IMPLEMENTED_SEARCH_PROVIDER_MODES], ['fixture']);
  assert.deepEqual([...PLANNED_SEARCH_PROVIDER_MODES].sort(), ['host_web_search', 'medialyst', 'rss_atom']);
  assert.equal(SEARCH_PROVIDER_NOT_IMPLEMENTED, 'NOT_IMPLEMENTED');
  assert.equal(MEDIALYST_NOT_IMPLEMENTED, 'NOT_IMPLEMENTED');
  const isNotImplemented = (mode) => (err) => err.code === 'NOT_IMPLEMENTED' && err.mode === mode;
  assert.throws(() => createHostWebSearchProvider(), isNotImplemented('host_web_search'));
  assert.throws(() => createRssAtomSearchProvider(), isNotImplemented('rss_atom'));
  assert.throws(() => createSearchProvider({ mode: 'host_web_search' }), isNotImplemented('host_web_search'));
  assert.throws(() => createSearchProvider({ mode: 'rss_atom' }), isNotImplemented('rss_atom'));
  assert.throws(() => createSearchProvider({ mode: 'bing' }), (err) => err.code === 'UNKNOWN_SEARCH_PROVIDER_MODE');
  await assert.rejects(createSearchProvider({ mode: 'medialyst' }).search({}), isNotImplemented('medialyst'));
  assert.throws(() => createMedialystSearchProvider({ apiKey: 'secret' }), (err) => err.code === MEDIALYST_NOT_IMPLEMENTED);
});

test('the pin is frozen, exact, and records no binary until the owner reviews one', () => {
  assert.equal(NEWSJACK_PIN.upstream, 'https://github.com/elvisun/newsjack');
  assert.equal(NEWSJACK_PIN.version, 'v0.1.19');
  assert.match(NEWSJACK_PIN.commit, /^[a-f0-9]{40}$/);
  assert.equal(NEWSJACK_PIN.commit, 'bdb41b8d1f9a9e27221cc86102cbfe1a748fc123');
  assert.equal(NEWSJACK_PIN.tag_object, '8c20b879186363a939b1c4a7b626107d7df84c58');
  assert.equal(NEWSJACK_PIN.tag_signed, false);
  assert.equal(NEWSJACK_PIN.license.spdx, 'MIT');
  assert.ok(Object.isFrozen(NEWSJACK_PIN) && Object.isFrozen(NEWSJACK_PIN.binaries) && Object.isFrozen(NEWSJACK_PIN.reviewed_emitters));
  for (const value of Object.values(NEWSJACK_PIN.binaries)) assert.ok(value === null || /^[a-f0-9]{64}$/.test(value));
  assert.deepEqual(Object.values(NEWSJACK_PIN.binaries), [null, null]);
  assert.equal(pinnedBinarySha256(), null);
  for (const file of ['detector_run.go', 'detector_models.go', 'detector_sources.go', 'detector_scoring.go', 'cluster.go', 'origin.go', 'update.go']) {
    assert.match(NEWSJACK_PIN.reviewed_emitters[`apps/cli/cmd/newsjack/${file}`], /^[a-f0-9]{40}$/, file);
  }
  assert.ok(!JSON.stringify(NEWSJACK_PIN).includes('latest'));
  assert.deepEqual([...NEWSJACK_PIN.allowed_subcommands], ['version', 'detector run', 'cluster', 'origin-apply']);
});

test('the discovery doc and license note quote the pinned commit', () => {
  for (const path of ['docs/NEWSJACK-LICENSE.md', 'media-lens/docs/newsjack-discovery.md']) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(text.includes(NEWSJACK_PIN.commit), path);
    assert.ok(text.includes(NEWSJACK_PIN.version), path);
  }
});
