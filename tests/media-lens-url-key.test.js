import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedURLKey } from '../media-lens/worker/url-key.js';

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
