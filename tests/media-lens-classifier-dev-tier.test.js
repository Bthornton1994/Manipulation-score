// Issue #118 remediation D: classifier.dev default requested tier is fast.
// Smart only when MEDIA_LENS_CLASSIFIER_DEV_TIER=smart (exact). Live flags
// stay off. No TypeSafe key. No secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifierDevAdapterEnabled,
  effectiveLiveFlags,
  loadConfig,
  publicConfig
} from '../media-lens/worker/config.js';
import {
  DEFAULT_TIER,
  SMART_TIER,
  buildClassifyRequest,
  normalizeTier,
  readClassifierDevTier
} from '../media-lens/worker/classifier-dev/contract.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { CDEV_LABEL_IDS } from '../media-lens/worker/classifier-dev/taxonomy.js';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';

function capturingAdapter(seen) {
  return {
    enabled: true,
    async classify({ tier }) {
      seen.push(tier);
      return {
        ok: true,
        results: [
          {
            ok: true,
            label: 'no_detected_signal',
            confidence: 0.9,
            model: 'jev-1.13.0',
            modelMatch: true
          }
        ],
        meta: { classifications: 1, model: 'jev-1.13.0', tier },
        networkCalls: 1
      };
    }
  };
}

test('code default and unset/empty MEDIA_LENS_CLASSIFIER_DEV_TIER are fast', () => {
  assert.equal(DEFAULT_TIER, 'fast');
  assert.equal(SMART_TIER, 'smart');
  assert.equal(readClassifierDevTier(undefined), 'fast');
  assert.equal(readClassifierDevTier(null), 'fast');
  assert.equal(readClassifierDevTier(''), 'fast');
  assert.equal(normalizeTier(undefined), 'fast');
  assert.equal(normalizeTier(''), 'fast');
  assert.equal(loadConfig({}).classifierDev.tier, 'fast');
  assert.equal(loadConfig({ MEDIA_LENS_CLASSIFIER_DEV_TIER: '' }).classifierDev.tier, 'fast');
  assert.equal(publicConfig(loadConfig({})).classifierDev.tier, 'fast');
  const defaulted = buildClassifyRequest({
    inputs: ['The committee met on Tuesday.'],
    labels: ['alpha', 'beta']
  });
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.body.tier, 'fast');
});

test('smart is selected only when MEDIA_LENS_CLASSIFIER_DEV_TIER=smart exactly', () => {
  assert.equal(readClassifierDevTier('smart'), 'smart');
  assert.equal(loadConfig({ MEDIA_LENS_CLASSIFIER_DEV_TIER: 'smart' }).classifierDev.tier, 'smart');
  assert.equal(publicConfig(loadConfig({ MEDIA_LENS_CLASSIFIER_DEV_TIER: 'smart' })).classifierDev.tier, 'smart');
  assert.equal(normalizeTier('smart'), 'smart');
  assert.equal(normalizeTier('fast'), 'fast');

  for (const raw of ['SMART', 'Smart', ' smart', 'smart ', 'true', 'TRUE', '1', 'yes', 'fast ']) {
    assert.equal(readClassifierDevTier(raw), 'fast', `expected fast for ${JSON.stringify(raw)}`);
    assert.equal(
      loadConfig({ MEDIA_LENS_CLASSIFIER_DEV_TIER: raw }).classifierDev.tier,
      'fast',
      `config expected fast for ${JSON.stringify(raw)}`
    );
  }
});

test('ENABLE_CLASSIFIER_DEV remains default-off and kill switch still zeros calls', async () => {
  const unset = loadConfig({});
  assert.equal(unset.classifierDev.enabled, false);
  assert.equal(unset.liveEnabled, false);
  assert.equal(unset.liveUrlEnabled, false);
  assert.equal(classifierDevAdapterEnabled(unset), false);
  assert.equal(effectiveLiveFlags(unset).classifierDevEnabled, false);
  assert.equal(effectiveLiveFlags(unset).killSwitch, false);
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_CLASSIFIER_DEV, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE_URL, 'true');
  assert.notEqual(process.env.MEDIA_LENS_CLASSIFIER_DEV_TIER, 'smart');

  let hits = 0;
  const off = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(unset),
    fetchImpl: async () => {
      hits += 1;
      throw new Error('default-off must not fetch');
    }
  });
  const offResult = await off.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: CDEV_LABEL_IDS
  });
  assert.equal(hits, 0);
  assert.equal(offResult.networkCalls, 0);
  assert.equal(offResult.results[0].reason, 'disabled');

  const killed = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_CLASSIFIER_DEV_TIER: 'smart',
    MEDIA_LENS_KILL_SWITCH: 'true'
  });
  assert.equal(killed.classifierDev.enabled, true);
  assert.equal(killed.classifierDev.tier, 'smart');
  assert.equal(classifierDevAdapterEnabled(killed), false);
  assert.equal(effectiveLiveFlags(killed).killSwitch, true);

  let killHits = 0;
  const killAdapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(killed),
    isKillSwitchAsserted: () => true,
    fetchImpl: async () => {
      killHits += 1;
      throw new Error('kill switch must not fetch');
    }
  });
  const killResult = await killAdapter.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: CDEV_LABEL_IDS,
    tier: killed.classifierDev.tier
  });
  assert.equal(killHits, 0);
  assert.equal(killResult.networkCalls, 0);
});

test('selective cascade uses the configured classifier.dev tier', async () => {
  const seen = [];

  seen.length = 0;
  const unsetConfig = loadConfig({ MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true' });
  assert.equal(unsetConfig.classifierDev.tier, 'fast');
  assert.equal(unsetConfig.liveUrlEnabled, false);
  const unsetGraph = await runFixture('synthetic-01-quoted-vs-authorial', {
    config: unsetConfig,
    classifierDevAdapter: capturingAdapter(seen)
  });
  assert.ok(seen.length >= 1, 'cascade must request a tier when enabled');
  assert.ok(seen.every((tier) => tier === 'fast'));
  assert.equal(unsetGraph.engine.classifier_dev.tier_requested, 'fast');
  assert.equal(unsetGraph.engine.classifier_dev.evaluation_only, true);

  seen.length = 0;
  const smartConfig = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_CLASSIFIER_DEV_TIER: 'smart'
  });
  assert.equal(smartConfig.classifierDev.tier, 'smart');
  const smartGraph = await runFixture('synthetic-01-quoted-vs-authorial', {
    config: smartConfig,
    classifierDevAdapter: capturingAdapter(seen)
  });
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((tier) => tier === 'smart'));
  assert.equal(smartGraph.engine.classifier_dev.tier_requested, 'smart');

  seen.length = 0;
  const smartUpperConfig = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_CLASSIFIER_DEV_TIER: 'SMART'
  });
  assert.equal(smartUpperConfig.classifierDev.tier, 'fast');
  const smartUpperGraph = await runFixture('synthetic-01-quoted-vs-authorial', {
    config: smartUpperConfig,
    classifierDevAdapter: capturingAdapter(seen)
  });
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((tier) => tier === 'fast'));
  assert.equal(smartUpperGraph.engine.classifier_dev.tier_requested, 'fast');
});

test('docs and runbook state the default classifier.dev tier is fast', async () => {
  const runbook = await readFile('docs/media-lens-ops-runbook-v2.md', 'utf8');
  const mediaLensReadme = await readFile('media-lens/README.md', 'utf8');
  const rootReadme = await readFile('README.md', 'utf8');
  const evalDoc = await readFile('docs/media-lens-classifier-dev-eval.md', 'utf8');
  assert.match(runbook, /MEDIA_LENS_CLASSIFIER_DEV_TIER/);
  assert.match(runbook, /Unset\/empty → `fast`/);
  assert.match(runbook, /exact string `smart`/);
  assert.doesNotMatch(runbook, /MEDIA_LENS_CLASSIFIER_DEV_TIER` \| `smart`/);
  assert.match(mediaLensReadme, /unset\/empty → `fast`/);
  assert.match(rootReadme, /default requested tier is `fast`/);
  assert.match(evalDoc, /default requested tier is `fast`/);
  const src = await readFile('media-lens/worker/classifier-dev/contract.js', 'utf8');
  assert.match(src, /export const DEFAULT_TIER = 'fast'/);
  assert.doesNotMatch(src, /export const DEFAULT_TIER = 'smart'/);
});
