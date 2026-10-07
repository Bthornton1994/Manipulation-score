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
