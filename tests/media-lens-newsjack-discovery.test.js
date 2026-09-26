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
  NEWSJACK_GROUPING_NOTE,
  NEWSJACK_INDEPENDENCE_NOTE,
  NEWSJACK_MEMBER_REJECTIONS,
  NEWSJACK_ORIGIN_NOTE,
  NEWSJACK_SAME_STORY_NOTE,
  NEWSJACK_SOURCE_KINDS,
  NON_OUTLET_HOSTS,
  REDIRECTOR_HOSTS,
  NON_PUBLIC_HOST_SUFFIXES,
  captureToStoryDiscovery,
  classifySourceUrl,
  displayText,
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
import { FIXTURE_REQUEST, FIXTURE_TIMINGS, buildFixtureCapture, raw, rawText, testPin } from './helpers/newsjack-fixtures.js';

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
  const candidates = raw('raw-detector-mock-shape.json');
  const clustered = raw('raw-cluster-mock-shape.json');
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
  assert.deepEqual(document.provenance.retrieval_interval, {
    not_before: FIXTURE_TIMINGS.detector_run[0],
    not_after: FIXTURE_TIMINGS.detector_run[1],
    basis: 'runner_observed_detector_start_and_exit'
  });
  assert.equal(document.provenance.newsjack_generated_at, '2026-09-25T18:00:00.052314Z');
  assert.equal(document.provenance.commit, NEWSJACK_PIN.commit);
  assert.equal(document.provenance.binary_check, 'fixture_unhashed');
  assert.equal(document.provenance.clusters_without_members, 1);
  assert.equal(document.provenance.provider_selection.evidence_truncated, 2);
  assert.equal(document.privacy.article_pages_fetched, false);
  assert.equal(document.privacy.provider_article_pages_fetched, 'unknown_agent_retrieval');

  assert.deepEqual(document.clusters.map((cluster) => cluster.cluster_id), [FARE_CLUSTER, STUDY_CLUSTER]);
  const fare = document.clusters[0];
  assert.equal(fare.cluster_basis, NEWSJACK_CLUSTER_BASIS);
  // The grouping description matches v0.1.19: detector Jaccard over title
  // and snippet text, then the cluster step's URL or title-word overlap.
  assert.deepEqual(fare.cluster_params, { title_overlap: 0.6, min_shared_tokens: 2, detector_jaccard: 0.32, detector_text: 'title_and_snippet', basis: 'pinned_source_review' });
  assert.equal(fare.grouping_note, NEWSJACK_GROUPING_NOTE);
  assert.match(NEWSJACK_GROUPING_NOTE, /snippets \(Jaccard 0\.32\)/);
  assert.equal(fare.independence_note, NEWSJACK_INDEPENDENCE_NOTE);
  assert.equal(fare.same_story_note, NEWSJACK_SAME_STORY_NOTE);
  assert.doesNotMatch(document.message, /title words/);
  // Pin the wording itself, not only the constants.
  assert.equal(NEWSJACK_CLUSTER_BASIS, 'newsjack_detector_text_similarity_and_cluster_overlap');
  assert.equal(NEWSJACK_INDEPENDENCE_NOTE, 'Text similarity is not evidence of independent reporting, so no member is labeled independent.');
  assert.equal(NEWSJACK_SAME_STORY_NOTE, 'Similar text is same-story evidence only. It is not independent reporting.');
  assert.match(NEWSJACK_ORIGIN_NOTE, /detector_timestamp_fallback/);
  assert.doesNotMatch(JSON.stringify(document), /matching title/i);
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
  assert.equal(row.outcome, 'checked');
  assert.equal(row.error, null);
  assert.equal(row.newsjack_evidence_count, 18);
  assert.equal(row.item_count, 5);
  const expected = {
    incomplete: 1,
    non_https_url: 1,
    non_public_url: 1,
    non_outlet_host: 0,
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
  assert.equal(claim.first_public_at_precision, 'time');
  assert.deepEqual(claim.timestamp_evidence.map((entry) => entry.precision), ['time', 'time']);
  const [studyClaim] = withOrigin.clusters[1].origin_claims;
  assert.equal(studyClaim.freshness_status, 'stale');
  // The skill allows a date-only first_public_at. It is kept as a date with
  // its precision, never turned into midnight and never counted as invalid.
  assert.equal(studyClaim.first_public_at, '2026-09-20');
  assert.equal(studyClaim.first_public_at_precision, 'date');
  assert.equal(studyClaim.withheld.invalid_values, 0);
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
  for (const marker of ['SENTINEL-EXCERPT', 'SENTINEL-AUTHOR', 'SENTINEL-METADATA', 'SENTINEL-RATIONALE']) {
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

test('a capture in the --mock output shape converts to empty because mock dates carry no time', () => {
  const capture = mockCapture();
  assert.deepEqual(validateNewsjackCapture(capture, { pin: testPin(FAKE_HASH) }), { ok: true, errors: [] });
  const document = captureToStoryDiscovery(capture, { now: Date.parse('2026-09-25T18:00:02.000Z'), pin: testPin(FAKE_HASH) });
  assert.equal(document.status, 'empty');
  assert.equal(document.reason, 'no_accepted_members');
  // The converter checks only that the capture names a hash recorded in the
  // pin; the runner is what hashed the executed file.
  assert.equal(document.provenance.binary_check, 'recorded_in_pin');
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
    c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].source = 'reddit';
    c.sources.reddit = { requested: true, available: true, attempted: true, evidence_count: 1, status: 'used', error_class: null };
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

function sourceErrorCapture() {
  const at = (started, exited) => ({ started, exited });
  const timings = {
    version: at('2026-09-25T18:09:59.900Z', '2026-09-25T18:09:59.950Z'),
    detector_run: at('2026-09-25T18:10:00.000Z', '2026-09-25T18:10:00.310Z'),
    cluster: at('2026-09-25T18:10:00.380Z', '2026-09-25T18:10:00.450Z')
  };
  const steps = Object.entries(timings).map(([name, { started, exited }]) => ({
    step: name,
    started_at: started,
    exited_at: exited,
    exit_code: 0,
    timed_out: false,
    stdout_bytes: 10,
    stderr_bytes: 0
  }));
  return projectCapture({
    request: FIXTURE_REQUEST,
    pin: NEWSJACK_PIN,
    binarySha256: null,
    mode: 'fixture',
    steps,
    candidates: raw('raw-detector-source-error.json'),
    clustered: raw('raw-cluster-source-error.json')
  });
}

test('a source error reaches the capture only as a reduced class, and an unchecked run says so', () => {
  const rawError = JSON.stringify(raw('raw-detector-source-error.json'));
  assert.ok(rawError.includes('medialyst.ai') && rawError.includes('Client.Timeout'), 'the raw fixture carries real-shaped error text');
  const capture = sourceErrorCapture();
  assert.deepEqual(validateNewsjackCapture(capture), { ok: true, errors: [] });
  assert.deepEqual(capture.sources.news_search, { requested: true, available: true, attempted: true, evidence_count: 0, status: 'error', error_class: 'timeout' });
  const document = captureToStoryDiscovery(capture, { now: NOW });
  assert.deepEqual(validateStoryDiscovery(document), { ok: true, errors: [] });
  assert.equal(document.status, 'empty');
  assert.equal(document.reason, 'no_member_source_checked');
  assert.match(document.message, /nothing was checked/);
  assert.equal(document.sources_checked[0].outcome, 'failed');
  assert.equal(document.sources_checked[0].error, 'timeout');
  const serialized = JSON.stringify(capture) + JSON.stringify(document);
  for (const marker of ['medialyst.ai', 'Client.Timeout', 'Post "', 'deadline']) assert.ok(!serialized.includes(marker), marker);
});

test('forum, social, video, short-link, and aggregator hosts never become outlet members', () => {
  for (const url of ['https://www.reddit.com/r/transit/comments/abc/fare', 'https://news.ycombinator.com/item?x', 'https://x.com/agency/status/1', 'https://t.co/abc', 'https://m.youtube.com/watch', 'https://news.google.com/articles/abc', 'https://www.linkedin.com/pulse/fare']) {
    const capture = mutated((c) => {
      c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].url = url;
    });
    const document = captureToStoryDiscovery(capture, { now: NOW });
    const row = document.sources_checked.find((entry) => entry.source_id === 'newsjack:news_search');
    const study = document.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
    assert.equal(study, undefined, url);
    assert.equal(row.rejected_non_outlet_host, 1, url);
  }
  assert.ok(NON_OUTLET_HOSTS.includes('reddit.com') && NON_OUTLET_HOSTS.includes('news.google.com'));
});

test('a URL is used once across the whole document, whatever time a later copy reports', () => {
  // The Harbor Times URL is already a FARE member; the Lakeside URL was
  // rejected in RIDERS as outside the window. A later copy with an
  // in-window time must not win either way.
  for (const url of ['https://harbor-times.example/local/transit-fare-vote', 'https://lakeside-gazette.example/fare']) {
    const capture = mutated((c) => {
      c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].url = url;
    });
    const document = captureToStoryDiscovery(capture, { now: NOW });
    assert.equal(document.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER), undefined, url);
    const row = document.sources_checked.find((entry) => entry.source_id === 'newsjack:news_search');
    assert.equal(row.rejected_duplicate_url, 2, url);
    const urls = document.clusters.flatMap((cluster) => cluster.members.map((member) => member.canonical_url));
    assert.equal(new Set(urls).size, urls.length);
  }
});

test('origin-claim URLs pass the same public-link policy as members and must be canonical', () => {
  const unsafe = mutated((c) => {
    c.origin.claims[0].original_url = 'https://169.254.169.254/latest';
    c.origin.claims[0].timestamp_evidence[1].url = 'https://metro.internal/fare';
  });
  assert.equal(validateNewsjackCapture(unsafe).ok, true, 'the contract checks shape; the converter applies the link policy');
  const [claim] = captureToStoryDiscovery(unsafe, { now: NOW }).clusters[0].origin_claims;
  assert.equal(claim.original_url, null);
  assert.deepEqual(claim.timestamp_evidence.map((entry) => entry.url), ['https://harbor-times.example/local/transit-fare-vote']);
  assert.equal(claim.withheld.urls, 4);
  for (const url of ['https://Harbor-Times.example/local/transit-fare-vote', ' https://harbor-times.example/a', 'https://harbor-times.example/a\n', 'https://harbor-times.example/a b', 'https://user@harbor-times.example/a']) {
    const capture = mutated((c) => {
      c.origin.claims[0].original_url = url;
    });
    assert.ok(codes(validateNewsjackCapture(capture)).includes('origin_invalid'), JSON.stringify(url));
  }
});

test('origin freshness windows are tied to the run', () => {
  for (const window of [
    { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z', hours: 1 },
    { start: '2026-09-24T18:00:01.052Z', end: '2026-09-25T18:00:01.052Z', hours: 24 },
    { start: '2026-09-24T18:00:00.052Z', end: '2026-09-25T18:00:00.052Z', hours: 23 }
  ]) {
    const capture = mutated((c) => {
      c.origin.claims[0].freshness_window = window;
    });
    assert.ok(codes(validateNewsjackCapture(capture)).includes('origin_invalid'), JSON.stringify(window));
  }
});

test('origin claims never change membership, including clusters without a claim', () => {
  const withoutStudyClaim = captureToStoryDiscovery(
    mutated((c) => {
      c.origin.claims.splice(1, 1);
    }),
    { now: NOW }
  );
  const withoutOrigin = captureToStoryDiscovery(buildFixtureCapture({ withOrigin: false }), { now: NOW });
  const strip = (document) => document.clusters.map((cluster) => ({ id: cluster.cluster_id, members: cluster.members }));
  assert.deepEqual(strip(withoutStudyClaim), strip(withoutOrigin));
  assert.equal(withoutStudyClaim.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER).origin_claims, undefined);
  assert.ok(withoutStudyClaim.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER).members.length > 0);
});

test('source status must agree with the evidence present', () => {
  for (const fn of [(c) => (c.sources.news_search.status = 'unavailable'), (c) => (c.sources.news_search.status = 'no_results'), (c) => (c.sources.news_search.evidence_count = 3)]) {
    assert.ok(codes(validateNewsjackCapture(mutated(fn))).includes('source_evidence_inconsistent'));
  }
});

test('capture times must be plausible calendar times', () => {
  for (const year of ['0001', '2019', '2200']) {
    const capture = mutated((c) => {
      for (const step of c.process.steps) {
        step.started_at = step.started_at.replace('2026', year);
        step.exited_at = step.exited_at.replace('2026', year);
      }
      c.monitor.generated_at = c.monitor.generated_at.replace('2026', year);
    });
    const document = captureToStoryDiscovery(capture, { now: NOW });
    assert.equal(document.status, 'abstain', year);
    assert.equal(document.sources_checked[0].error, 'time_invalid', year);
    assert.equal(validateStoryDiscovery(document).ok, true);
  }
});

test('abstain errors name unknown keys generically, never by their text', () => {
  const capture = mutated((c) => {
    c.sources['Visit https://evil.example/claim now'] = structuredClone(c.sources.news_search);
    c.signals[0].evidence[0]['https://evil.example/?token=1'] = 'x';
  });
  const document = captureToStoryDiscovery(capture, { now: NOW });
  assert.equal(document.status, 'abstain');
  assert.ok(document.errors.some((error) => error.path === '$.sources.*'));
  assert.ok(document.errors.some((error) => error.path === '$.signals[0].evidence[0].*'));
  assert.ok(!JSON.stringify(document).includes('evil.example'));
});

test('titles and outlet names are display text; host-like names are not outlets', () => {
  // Controls become spaces; invisible format characters are removed without
  // splitting a word.
  assert.equal(displayText('Fare ‮vote\u0007  set\u009b'), 'Fare vote set');
  assert.equal(displayText('葛\u{e0100}飾区'), '葛飾区');
  assert.equal(displayText('❤️Love'), '❤Love');
  for (const value of ['www.evil.example/path', '169.254.169.254', '169.254.169.254/latest/meta-data', 'metro.internal/admin?token=abc', 'harbor-times.example:8080', '[fd00::1]', 'fd00::1']) {
    assert.equal(outletText(value), '', value);
  }
  assert.equal(outletText('Harbor Times'), 'Harbor Times');
  assert.equal(outletText('Reuters.com'), 'Reuters.com', 'a bare publication domain name with no path stays readable text');
  const capture = mutated((c) => {
    const evidence = c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0];
    evidence.title = 'Transit agency‮ publishes\u0000 fare study';
  });
  const study = captureToStoryDiscovery(capture, { now: NOW }).clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
  assert.equal(study.members[0].article_title, 'Transit agency publishes fare study');
});

test('the projection stores copied snippets as empty titles and nulls over-long values instead of cutting them', () => {
  const snippet = buildFixtureCapture().signals.flatMap((signal) => signal.evidence).find((evidence) => evidence.title_from_excerpt);
  assert.equal(snippet.title, '');
  assert.ok(!JSON.stringify(buildFixtureCapture()).includes('officials weigh options'));

  const candidates = raw('raw-detector.json');
  const clustered = raw('raw-cluster.json');
  const study = (doc) => doc.signals.find((signal) => signal.id === STUDY_CLUSTER);
  const astral = '\u{1d4d5}'.repeat(600); // 1200 UTF-16 units
  for (const doc of [candidates, clustered]) {
    const evidence = study(doc).evidence[0];
    evidence.container = `Capital Observer${' '.repeat(300)}https://metro.internal/x`;
    evidence.published_at = `2026-09-25T14:05:00.250Z${' '.repeat(60)}junk`;
    evidence.title = astral;
  }
  const steps = ['version', 'detector_run', 'cluster'].map((name) => ({
    step: name,
    started_at: FIXTURE_TIMINGS[name][0],
    exited_at: FIXTURE_TIMINGS[name][1],
    exit_code: 0,
    timed_out: false,
    stdout_bytes: 10,
    stderr_bytes: 0
  }));
  const capture = projectCapture({ request: FIXTURE_REQUEST, pin: NEWSJACK_PIN, binarySha256: null, mode: 'fixture', steps, candidates, clustered });
  assert.deepEqual(validateNewsjackCapture(capture), { ok: true, errors: [] });
  const evidence = capture.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0];
  assert.equal(evidence.container, null);
  assert.equal(evidence.published_at, null);
  assert.ok(evidence.title.length <= 1000 && evidence.title.length > 990);
  assert.equal(Array.from(evidence.title).every((ch) => ch === '\u{1d4d5}'), true, 'no character is split');
  const document = captureToStoryDiscovery(capture, { now: NOW });
  assert.equal(document.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER), undefined);
});

test('rejected members are listed up to 200 per source while every rejection is counted', () => {
  const capture = buildFixtureCapture({ withOrigin: false });
  const ids = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(16, '0'));
  capture.signals = ids.map((id, i) => ({
    id,
    evidence: Array.from({ length: 8 }, (_, j) => ({
      source: 'news_search',
      title: `Story ${i} item ${j}`,
      url: `http://outlet-${i}-${j}.example/a`,
      container: `Outlet ${i} ${j}`,
      published_at: '2026-09-25T12:00:00Z',
      title_from_excerpt: false
    }))
  }));
  capture.clustering.groups = ids.map((id) => ({ cluster_id: id, signal_ids: [id] }));
  Object.assign(capture.selection, { total_scored_signals: 50, total_emitted_signals: 50, signals_not_emitted: 0, evidence_truncated: 0, limit: 50 });
  capture.request.limit = 50;
  capture.sources.news_search.evidence_count = 400;
  withId(capture);
  assert.equal(validateNewsjackCapture(capture).ok, true);
  const row = captureToStoryDiscovery(capture, { now: NOW }).sources_checked[0];
  assert.equal(row.rejected_total, 400);
  assert.equal(row.rejected_non_https_url, 400);
  assert.equal(row.rejected_members.length, 200);
});

test('the host policy covers current social, short-link, and country search domains', () => {
  for (const url of ['https://www.threads.com/@agency/post/1', 'https://bit.ly/abc', 'https://t.me/agency/1', 'https://vimeo.com/1', 'https://www.google.co.uk/search', 'https://news.google.de/articles/x', 'https://search.yahoo.com/search']) {
    const capture = mutated((c) => {
      c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].url = url;
    });
    const document = captureToStoryDiscovery(capture, { now: NOW });
    assert.equal(document.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER), undefined, url);
    assert.equal(document.sources_checked[0].rejected_non_outlet_host, 1, url);
  }
  assert.ok(REDIRECTOR_HOSTS.every((host) => NON_OUTLET_HOSTS.includes(host)));
});

test('outlet names refuse link-like and blank text, and are cut without splitting a character', () => {
  // The fullwidth cases without a path are caught only after NFKC folding.
  for (const value of ['tel:+15551234567', 'sms:5551234', 'user@evil.example', 'localhost', 'metadata.google.internal', 'printer.home.arpa', 'ｗｗｗ.evil.example/x', 'ｗｗｗ.evil.example', 'ｈｔｔｐｓ：／／evil.example', 'evil。example/x', 'ㅤ', '⠀⠀']) {
    assert.equal(outletText(value), '', JSON.stringify(value));
  }
  assert.equal(outletText('Reuters.com'), 'Reuters.com');
  // U+20000 is unchanged by NFKC, so the cut must not split its surrogate pair.
  const cut = outletText(`${'A'.repeat(199)}\u{20000}B`);
  assert.equal(Array.from(cut).length, 200);
  assert.doesNotMatch(cut, /[\ud800-\udbff]$/);
  assert.equal(displayText('ㅤ⠀ Fareᅟ vote'), 'Fare vote');

  const capture = mutated((c) => {
    const evidence = c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0];
    evidence.container = 'O'.repeat(250);
    evidence.title = 'T'.repeat(400);
  });
  const study = captureToStoryDiscovery(capture, { now: NOW }).clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
  assert.equal(study.members[0].outlet.length, 200);
  assert.equal(study.members[0].article_title.length, 300);
  const blank = mutated((c) => {
    c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].title = 'ㅤ⠀';
  });
  const blankDoc = captureToStoryDiscovery(blank, { now: NOW });
  assert.equal(blankDoc.clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER), undefined);
});

test('deeply nested capture JSON abstains instead of throwing', () => {
  const text = JSON.stringify(buildFixtureCapture({ withOrigin: false }));
  const deep = text.replace('"origin":null', `"origin":${'{"a":'.repeat(50000)}1${'}'.repeat(50000)}`);
  assert.ok(deep.length < NEWSJACK_CAPTURE_MAX_TEXT_BYTES);
  const document = captureToStoryDiscovery(deep, { now: NOW });
  assert.equal(document.status, 'abstain');
  assert.equal(document.sources_checked[0].error, 'capture_structure_invalid');
  assert.deepEqual(codes(validateNewsjackCapture(JSON.parse(deep))), ['capture_structure_invalid']);
});

test('source status flags must agree with each other and signals must fit the limit', () => {
  const cases = [
    ['source_status_inconsistent', (c) => (c.sources.news_search.requested = false)],
    ['source_status_inconsistent', (c) => (c.sources.news_search.error_class = 'timeout')],
    ['source_status_inconsistent', (c) => Object.assign(c.sources.news_search, { status: 'error', error_class: null })],
    ['selection_invalid', (c) => Object.assign(c.request, { limit: 3 }) && Object.assign(c.selection, { limit: 3 })]
  ];
  for (const [code, fn] of cases) assert.ok(codes(validateNewsjackCapture(mutated(fn))).includes(code), code);
  const partial = captureToStoryDiscovery(
    mutated((c) => Object.assign(c.sources.news_search, { status: 'partial_error', error_class: 'timeout' })),
    { now: NOW }
  );
  assert.equal(partial.status, 'ok');
  assert.equal(partial.sources_checked[0].outcome, 'partial');
  assert.equal(partial.sources_checked[0].error, 'timeout');
});

test('an empty result says whether the search returned nothing or everything was dropped', () => {
  const noResults = buildFixtureCapture({ withOrigin: false });
  noResults.signals = [];
  noResults.clustering.groups = [];
  Object.assign(noResults.selection, { total_scored_signals: 0, total_emitted_signals: 0, signals_not_emitted: 0, evidence_truncated: 0 });
  Object.assign(noResults.sources.news_search, { evidence_count: 0, status: 'no_results' });
  withId(noResults);
  const document = captureToStoryDiscovery(noResults, { now: NOW });
  assert.equal(document.status, 'empty');
  assert.equal(document.reason, 'no_results');
  // Newsjack counts news_search items after its own filters, so the message
  // says what Newsjack kept, not what the provider returned.
  assert.match(document.message, /kept no news-search items after its own age, hygiene, and syndication filters/);
  assert.doesNotMatch(document.message, /returned no results/);
  // A partial source still counts as checked.
  const allDropped = mutated((c) => {
    Object.assign(c.sources.news_search, { status: 'partial_error', error_class: 'timeout' });
    for (const signal of c.signals) for (const evidence of signal.evidence) evidence.url = evidence.url.replace('https:', 'http:');
    c.origin = null;
    c.request.origin_findings_sha256 = null;
    c.process.steps.pop();
  });
  const dropped = captureToStoryDiscovery(allDropped, { now: NOW });
  assert.equal(dropped.reason, 'no_accepted_members');
});

test('capture contract edge rules: step order, one claim per cluster, date and precision labels, window span', () => {
  const cases = [
    ['process_order_invalid', (c) => (c.process.steps[2].started_at = '2026-09-25T18:00:03.400Z')],
    ['origin_invalid', (c) => c.origin.claims.push(structuredClone(c.origin.claims[0]))],
    ['origin_invalid', (c) => (c.origin.claims[1].first_public_at = '2026-02-30')],
    ['origin_invalid', (c) => (c.origin.claims[0].first_public_at_precision = 'date')],
    ['origin_invalid', (c) => (c.origin.claims[0].timestamp_evidence[0].precision = 'date')],
    ['origin_invalid', (c) => (c.origin.claims[0].freshness_window = { start: '2026-09-24T19:00:00.052Z', end: '2026-09-25T18:00:00.052Z', hours: 23 })],
    ['origin_invalid', (c) => (c.origin.claims[0].freshness_window = { start: '2026-09-24T19:00:00.052Z', end: '2026-09-25T18:00:00.052Z', hours: 24 })],
    ['origin_invalid', (c) => (c.origin.claims[0].original_url = 'https://harbor-times.example/local/transit-fare-vote#q=acme')],
    ['evidence_invalid', (c) => (c.signals.flatMap((signal) => signal.evidence).find((evidence) => evidence.title_from_excerpt).title = 'copied snippet')]
  ];
  for (const [code, fn] of cases) {
    const result = validateNewsjackCapture(mutated(fn));
    assert.ok(codes(result).includes(code), `${code}: got ${codes(result).join(',')}`);
  }
});

test('a published time at the retrieval bound is kept and one just after it is refused', () => {
  for (const [time, kept] of [['2026-09-25T18:00:03.410Z', true], ['2026-09-25T18:00:03.411Z', false]]) {
    const capture = mutated((c) => {
      c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].published_at = time;
    });
    const study = captureToStoryDiscovery(capture, { now: NOW }).clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
    assert.equal(Boolean(study), kept, time);
  }
});

test('origin citations withhold redirectors and fragments, and a refused basis value carries no precision', () => {
  const findings = raw('raw-origin.json');
  const claim = findings.signals[0];
  claim.story_origin.original_url = 'https://t.co/abc';
  claim.story_origin.timestamp_evidence[0].url = 'https://harbor-times.example/local/transit-fare-vote#search=acme';
  claim.story_origin.timestamp_evidence[1].published_at = 'garbage';
  claim.freshness_gate.basis_value = '2026-09-25 (morning, approx)';
  const steps = ['version', 'detector_run', 'cluster', 'origin_apply'].map((name) => ({
    step: name,
    started_at: FIXTURE_TIMINGS[name][0],
    exited_at: FIXTURE_TIMINGS[name][1],
    exit_code: 0,
    timed_out: false,
    stdout_bytes: 10,
    stderr_bytes: 0
  }));
  const capture = projectCapture({
    request: FIXTURE_REQUEST,
    pin: NEWSJACK_PIN,
    binarySha256: null,
    mode: 'fixture',
    steps,
    candidates: raw('raw-detector.json'),
    clustered: raw('raw-cluster.json'),
    targeted: findings,
    findingsSha256: 'b'.repeat(64)
  });
  assert.deepEqual(validateNewsjackCapture(capture), { ok: true, errors: [] });
  const [projected] = capture.origin.claims;
  assert.equal(projected.original_url, null);
  assert.deepEqual(projected.timestamp_evidence, [{ url: 'https://valley-ledger.example/2026/09/25/fare-vote', published_at: null, precision: null }]);
  assert.equal(projected.withheld.urls, 4);
  assert.equal(projected.withheld.invalid_values, 2);
  assert.equal(projected.freshness_basis_precision, null, 'Media Lens refuses the basis value, so it makes no precision claim');
  assert.equal(projected.freshness_status, 'fresh', "Newsjack's own status is kept, labeled unverified");
});

test('each source status branch is tied to its own flags', () => {
  const cases = [
    { status: 'no_results', available: false, evidence_count: 0, error_class: null },
    { status: 'unavailable', available: true, evidence_count: 0, error_class: null },
    { status: 'partial_error', evidence_count: 0, error_class: 'timeout' },
    { status: 'not_requested', requested: false, error_class: 'timeout' },
    { status: 'error', evidence_count: 3, error_class: 'timeout' }
  ];
  for (const patch of cases) {
    const capture = mutated((c) => Object.assign(c.sources.news_search, patch));
    assert.ok(codes(validateNewsjackCapture(capture)).includes('source_status_inconsistent'), JSON.stringify(patch));
  }
});

test('a search that reported items but emitted no signals is not called a search with no results', () => {
  const capture = buildFixtureCapture({ withOrigin: false });
  capture.signals = [];
  capture.clustering.groups = [];
  Object.assign(capture.selection, { total_scored_signals: 4, total_emitted_signals: 0, signals_not_emitted: 4, evidence_truncated: 0 });
  withId(capture);
  assert.equal(validateNewsjackCapture(capture).ok, true);
  const document = captureToStoryDiscovery(capture, { now: NOW });
  assert.equal(document.reason, 'no_accepted_members');
  assert.doesNotMatch(document.message, /kept no news-search items/);
});

test('outlet names also refuse .local, short or hex IP forms, invisible splitters, and a cut that would expose a host', () => {
  for (const value of ['printer.local', 'app.localhost', 'foo。local', 'instance-data', '127.1', '0x7f.0.0.1', '::ffff:10.0.0.1', 'evil͏.com/login', 'javascript️:alert(1)', 'about:blank', `${'a'.repeat(191)}.internal Daily`]) {
    assert.equal(outletText(value), '', JSON.stringify(value));
  }
  assert.equal(outletText('Harbor Times'), 'Harbor Times');
  assert.equal(outletText(`${'O'.repeat(199)} X`), 'O'.repeat(199), 'a cut never ends in a space');
  for (const value of ['1843', '360', '2130706433', '20 Minutes', 'AP/NORC']) assert.equal(outletText(value), value, 'plain numbers and ordinary names stay readable');
  for (const value of ['127.0.0.1.', '0x7f.1.', '0x7f000001', '[::1]:80', 'localhost:3000', 'intranet:8080', 'localhost/admin', 'instance-data/latest']) {
    assert.equal(outletText(value), '', value);
  }
  const titled = mutated((c) => {
    c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].title = `${'T'.repeat(299)} tail`;
  });
  const titledStudy = captureToStoryDiscovery(titled, { now: NOW }).clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
  assert.equal(titledStudy.members[0].article_title, 'T'.repeat(299), 'a title cut never ends in a space');
  for (const title of ['͏️', '\u{e0100}឴', '\ud800']) {
    const capture = mutated((c) => {
      c.signals.find((signal) => signal.id === STUDY_CLUSTER).evidence[0].title = title;
    });
    const study = captureToStoryDiscovery(capture, { now: NOW }).clusters.find((cluster) => cluster.cluster_id === STUDY_CLUSTER);
    assert.equal(study, undefined, JSON.stringify(title));
  }
});
