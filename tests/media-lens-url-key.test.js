import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizedURLKey } from '../media-lens/worker/url-key.js';
import { fuse } from '../media-lens/worker/fusion.js';

const NEWSJACK_FIXTURES = ['synthetic-01-quoted-vs-authorial', 'synthetic-02-syndicated-cluster'];

function recordedMembers() {
  return NEWSJACK_FIXTURES.flatMap((id) => {
    const doc = JSON.parse(readFileSync(new URL(`../media-lens/fixtures/newsjack/${id}.json`, import.meta.url), 'utf8'));
    return doc.cluster.members.filter((member) => member.url && member.url_key);
  });
}

function clusterCoverage(members) {
  return fuse({
    spans: [],
    claimCandidates: [],
    artifactHasUrl: true,
    jevAnswersBySpanId: new Map(),
    jevFailedSpanIds: new Set(),
    jevCalls: 0,
    jevMode: 'fixture',
    jevModelMatch: true,
    newsjackResult: { provenance: 'fixture', story_origin: null, freshness_gate: null, cluster: { members } }
  }).coverage.cluster;
}

test('url key lowercases scheme and host, drops the fragment, and trims one trailing slash', () => {
  assert.equal(normalizedURLKey('HTTPS://News.Example/Story/#top'), 'https://news.example/Story');
  assert.equal(normalizedURLKey('https://news.example'), 'https://news.example/');
  assert.equal(normalizedURLKey('https://news.example:8443/a'), 'https://news.example:8443/a');
  assert.equal(normalizedURLKey('https://news.example:443/a'), 'https://news.example/a');
});

test('url key strips tracking params case-insensitively and sorts the rest by name', () => {
  assert.equal(
    normalizedURLKey('https://news.example/a?UTM_Source=x&id=7&fbclid=y&b=2&gclid=z&mc_cid=1&mc_eid=2'),
    'https://news.example/a?b=2&id=7'
  );
  assert.equal(normalizedURLKey('https://news.example/a?utm_medium=x'), 'https://news.example/a');
  assert.equal(normalizedURLKey('https://news.example/a?id=7&b=2'), normalizedURLKey('https://news.example/a?b=2&id=7'));
});

test('url key keeps encoded query delimiters so distinct URLs never share a key', () => {
  const pairs = [
    ['https://news.example/story?a=1%26b%3D2', 'https://news.example/story?a=1&b=2'],
    ['https://news.example/story?a%3D1=2', 'https://news.example/story?a=1%3D2'],
    ['https://news.example/story?p=1%232', 'https://news.example/story?p=1'],
  ];
  for (const [left, right] of pairs) {
    const leftKey = normalizedURLKey(left);
    const rightKey = normalizedURLKey(right);
    assert.ok(leftKey && rightKey, `both URLs should produce a key: ${left} | ${right}`);
    assert.notEqual(leftKey, rightKey, `${left} and ${right} must not collide`);
  }
  assert.ok(!normalizedURLKey('https://news.example/story?p=1%232').includes('#'), 'key must not contain a raw fragment delimiter');
});

// Expected keys below are derived from source, not executed in Go: Newsjack
// origin.go normalizedURLKey (blob 365890b9, pinned in newsjack-pin.js) with
// Go net/url ParseQuery, QueryUnescape, Values.Encode, QueryEscape and the
// ForceQuery rule in url.Parse/URL.String.
const GO_DERIVED_QUERY_VECTORS = [
  // Spaces: literal, "+" and %20 all decode to a space and encode as "+".
  ['https://news.example/a?q=transit fare', 'https://news.example/a?q=transit+fare'],
  ['https://news.example/a?q=transit+fare', 'https://news.example/a?q=transit+fare'],
  ['https://news.example/a?q=transit%20fare', 'https://news.example/a?q=transit+fare'],
  // Non-ASCII: literal and encoded UTF-8 give the same uppercase escapes; a
  // lone byte that is not valid UTF-8 is kept as a byte.
  ['https://news.example/a?q=café', 'https://news.example/a?q=caf%C3%A9'],
  ['https://news.example/a?q=caf%c3%a9', 'https://news.example/a?q=caf%C3%A9'],
  ['https://news.example/a?q=%e9', 'https://news.example/a?q=%E9'],
  // "/" and ":" in values are escaped; "*" and "'" are escaped; "~" is not.
  ['https://news.example/a?next=/b:c', 'https://news.example/a?next=%2Fb%3Ac'],
  ['https://news.example/a?q=a*b~c', 'https://news.example/a?q=a%2Ab~c'],
  ['https://news.example/a?q=a*b%7Ec', 'https://news.example/a?q=a%2Ab~c'],
  ["https://news.example/a?q=it's", 'https://news.example/a?q=it%27s'],
  // Repeated names group together and keep their values in input order.
  ['https://news.example/a?x=2&y=1&x=1', 'https://news.example/a?x=2&x=1&y=1'],
  // Names sort bytewise, so uppercase sorts before lowercase.
  ['https://news.example/a?b=1&B=2&a=3', 'https://news.example/a?B=2&a=3&b=1'],
  // Empty and missing values both encode as "name="; empty pairs vanish.
  ['https://news.example/a?flag&&empty=', 'https://news.example/a?empty=&flag='],
  ['https://news.example/a?=x', 'https://news.example/a?=x'],
  ['https://news.example/a?%41=1', 'https://news.example/a?A=1'],
  // Go drops any pair containing ";" or an invalid escape.
  ['https://news.example/a?a=1;b=2&id=7', 'https://news.example/a?id=7'],
  ['https://news.example/a?a=%zz&id=7', 'https://news.example/a?id=7'],
  ['https://news.example/a?a=100%', 'https://news.example/a'],
  // A lone trailing "?" is kept (ForceQuery); a query emptied by tracking
  // removal is not.
  ['https://news.example/a?', 'https://news.example/a?'],
  ['https://news.example/a?#top', 'https://news.example/a?'],
  ['https://news.example/a?utm_source=x', 'https://news.example/a'],
  // Root with and without a trailing slash.
  ['https://news.example?b=2&a=1', 'https://news.example/?a=1&b=2'],
  ['https://news.example/?b=2&a=1', 'https://news.example/?a=1&b=2'],
];

test('url key query matches keys derived from the Newsjack Go source (derived from source, not executed in Go)', () => {
  for (const [input, goDerived] of GO_DERIVED_QUERY_VECTORS) {
    assert.equal(normalizedURLKey(input), goDerived, `${input} should key to the Go-derived ${goDerived}`);
  }
});

// Known deviations from Go outside the query, left in place on purpose
// (derived from source, not executed in Go):
// - no-hostname input: Go returns the lowercased input with trailing slashes
//   trimmed; this returns null;
// - path: Go re-escapes an already-escaped path (/caf%C3%A9 -> /caf%25C3%25A9)
//   and trims every trailing slash; this keeps WHATWG's path, minus one slash;
// - host: Go keeps userinfo and :443 and percent-escapes a non-ASCII host;
//   this drops userinfo and default ports and uses punycode.
test('url key returns null for non-string, blank, or unparseable input without throwing', () => {
  for (const input of [undefined, null, 42, {}, '', '   ', 'not a url', '/relative/path']) {
    assert.equal(normalizedURLKey(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('url key agrees with every recorded Newsjack url_key, including case, fragment and trailing-slash variants', () => {
  const members = recordedMembers();
  assert.ok(members.length >= 5, 'expected recorded Newsjack members with both url and url_key');
  for (const { url, url_key: recorded } of members) {
    const parsed = new URL(url);
    const variants = [
      url,
      `${url}/`,
      `${url}#section-2`,
      `${parsed.protocol.toUpperCase()}//${parsed.host.toUpperCase()}${parsed.pathname}`,
      `${url}?utm_source=feed&fbclid=abc`,
    ];
    for (const variant of variants) {
      assert.equal(normalizedURLKey(variant), recorded, `${variant} should key to the recorded ${recorded}`);
    }
  }
});

// The host and path pairs below are JS-only behavior; Go keys them apart.
test('url key treats encoded and literal unicode the same in host, path and query', () => {
  const pairs = [
    ['https://Café.Example/a', 'https://xn--caf-dma.example/a'],
    ['https://news.example/café', 'https://news.example/caf%C3%A9'],
    ['https://news.example/a?q=café', 'https://news.example/a?q=caf%C3%A9'],
    ['https://news.example/a?q=café#frag', 'https://NEWS.example/a/?q=caf%c3%a9'],
  ];
  for (const [left, right] of pairs) {
    assert.ok(normalizedURLKey(left), `expected a key for ${left}`);
    assert.equal(normalizedURLKey(left), normalizedURLKey(right), `${left} and ${right} should share a key`);
  }
});

test('fusion keeps recorded url_key values unchanged and falls back to the computed key only when one is missing', () => {
  const recorded = recordedMembers().filter((member) => member.relation !== 'syndicated').slice(0, 1);
  assert.equal(recorded.length, 1);
  const [withKey] = recorded;
  const parsed = new URL(withKey.url);
  const sameStoryVariant = { url: `https://${parsed.host.toUpperCase()}${parsed.pathname}/#top`, relation: 'same_story' };
  const coverage = clusterCoverage([withKey, sameStoryVariant]);
  assert.equal(coverage.members[0].url_key, withKey.url_key, 'recorded url_key must pass through unchanged');
  assert.equal(coverage.members[1].url_key, undefined, 'fusion must not write a computed key into a member');
  assert.equal(coverage.member_count, 2);
  assert.equal(coverage.independent_sources_estimate, 1, 'a case/fragment/trailing-slash variant is the same source');
});

test('fusion counts URLs that differ only by encoded query delimiters as separate sources', () => {
  const coverage = clusterCoverage([
    { url: 'https://first-outlet.example/story?a=1%26b%3D2', relation: 'surfaced' },
    { url: 'https://first-outlet.example/story?a=1&b=2', relation: 'same_story' },
  ]);
  assert.equal(coverage.member_count, 2);
  assert.equal(coverage.independent_sources_estimate, 2);
  assert.equal(coverage.duplicate_or_syndicated_count, 0);
});

test('fusion treats a Go-style url_key and a computed key for the same query-bearing URL as one source', () => {
  // Recorded keys are derived from source, not executed in Go.
  const pairs = [
    ['https://first-outlet.example/s?B=1&a=2', 'https://first-outlet.example/s?a=2&B=1'],
    ['https://first-outlet.example/s?q=a%2Ab~c', 'https://first-outlet.example/s?q=a*b%7Ec'],
    ['https://first-outlet.example/s?', 'https://first-outlet.example/s?'],
  ];
  for (const [goKey, url] of pairs) {
    const coverage = clusterCoverage([
      { url: goKey, url_key: goKey, relation: 'surfaced' },
      { url, relation: 'same_story' },
    ]);
    assert.equal(coverage.independent_sources_estimate, 1, `${url} should match the recorded ${goKey}`);
    assert.equal(coverage.duplicate_or_syndicated_count, 1);
  }
});
