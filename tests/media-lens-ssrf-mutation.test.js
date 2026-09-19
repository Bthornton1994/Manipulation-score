// Mutation evidence for Issue #118 critical live-URL controls.
// Each case patches a copy of the module, imports it, and shows the
// mutated control would fail closed policy. The live modules keep the control.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyIp } from '../media-lens/worker/address-policy.js';

async function loadMutatedAddressPolicy(mutate) {
  const original = await readFile('media-lens/worker/address-policy.js', 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, 'mutator must change the source');
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-ssrf-mutation-'));
  const dest = join(dir, 'address-policy.js');
  await writeFile(dest, mutated);
  return import(pathToFileURL(dest).href);
}

test('mutation: dropping NAT64 extraction would allow a loopback embedding as public IPv6', async () => {
  assert.equal(classifyIp('64:ff9b::7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0)',
      'if (false && words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0)'
    )
  );
  assert.equal(mutant.classifyIp('64:ff9b::7f00:1').disposition, 'allow_public');
});

test('mutation: dropping SIIT extraction would allow translated loopback as public IPv6', async () => {
  assert.equal(classifyIp('::ffff:0:7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0xffff && words[5] === 0)',
      'if (false && words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0xffff && words[5] === 0)'
    )
  );
  assert.equal(mutant.classifyIp('::ffff:0:7f00:1').disposition, 'allow_public');
});

test('mutation: dropping ::/96 compatible extraction would allow ::7f00:1 as public IPv6', async () => {
  assert.equal(classifyIp('::7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {\n    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, \'compat96\');\n  }',
      'if (false) {\n    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, \'compat96\');\n  }'
    )
  );
  assert.equal(mutant.classifyIp('::7f00:1').disposition, 'allow_public');
});

test('mutation: dropping mapped ::ffff:0:0/96 extraction would allow ::ffff:7f00:1 as public IPv6', async () => {
  assert.equal(classifyIp('::ffff:7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff)',
      'if (false && words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff)'
    )
  );
  assert.equal(mutant.classifyIp('::ffff:7f00:1').disposition, 'allow_public');
});

test('source: live URL gate, pin lookup, and no check-then-global-fetch', async () => {
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  const urlBlock = serverSrc.slice(serverSrc.indexOf("if (payload.mode === 'url')"));
  assert.match(urlBlock, /liveUrlEnabled/);
  assert.match(urlBlock, /live_url_disabled/);
  assert.ok(
    urlBlock.indexOf('liveUrlEnabled') < urlBlock.indexOf('fetchArticleSafely'),
    'LIVE_URL gate must run before fetchArticleSafely'
  );

  const fetchSrc = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  assert.doesNotMatch(fetchSrc, /fetchImpl\s*=\s*globalThis\.fetch/);
  assert.match(fetchSrc, /pinHost/);
  assert.match(fetchSrc, /REDIRECT_DOWNGRADE/);

  const pinSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(pinSrc, /makePinnedLookup/);
  assert.match(pinSrc, /remoteAddress/);
  assert.match(pinSrc, /PIN_MISMATCH/);
  assert.doesNotMatch(pinSrc, /process\.env/);

  const configSrc = await readFile('media-lens/worker/config.js', 'utf8');
  assert.match(configSrc, /MEDIA_LENS_ENABLE_LIVE_URL/);
  assert.match(configSrc, /liveUrlEnabled/);
});
