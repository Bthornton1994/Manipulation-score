#!/usr/bin/env node
// CLI: node media-lens/worker/analyze-fixture.js <fixture-id>
// Prints a validated influence-graph.v1 JSON document to stdout, built
// entirely from local fixture files (no network). Useful for local
// development, golden-output tests, and the smallest end-to-end vertical
// slice described in docs/media-lens-influence-graph-plan.md section 10.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareFromHtml } from './prepare.js';
import { createJevAdapter } from './adapters/jev.js';
import { createNewsjackAdapter } from './adapters/newsjack.js';
import { loadConfig } from './config.js';
import { analyze } from './analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

const FIXED_CONSENT_AT = '2026-09-18T00:00:00.000Z';

export async function runFixture(fixtureId, { config = loadConfig({}), classifierDevAdapter = null } = {}) {
  const articlePath = join(FIXTURES_DIR, 'articles', `${fixtureId}.html`);
  const html = await readFile(articlePath, 'utf8');
  const sourceUrl = `https://fictional-daily.example/articles/${fixtureId}`;

  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl, inputMode: 'fixture' });

  const jevAdapter = createJevAdapter({ mode: 'fixture', fixtureId, fixtureDir: join(FIXTURES_DIR, 'jev') });
  const newsjackAdapter = createNewsjackAdapter({ mode: 'fixture', fixtureId, fixtureDir: join(FIXTURES_DIR, 'newsjack') });

  return analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter,
    classifierDevAdapter,
    userAssertedPublic: true,
    consentAt: FIXED_CONSENT_AT,
    disclosureShown: true
  });
}

async function main() {
  const fixtureId = process.argv[2];
  if (!fixtureId) {
    console.error('Usage: node media-lens/worker/analyze-fixture.js <fixture-id>');
    process.exitCode = 1;
    return;
  }
  const graph = await runFixture(fixtureId);
  console.log(JSON.stringify(graph, null, 2));
}

function isRunAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
}

if (isRunAsCli()) {
  main();
}
