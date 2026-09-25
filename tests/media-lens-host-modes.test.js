// Behavioral tests for the Media Lens page on the live operator host and in
// catalog mode (local preview). They drive the real media-lens.js against a
// fake DOM parsed from the real index.html. See tests/helpers/media-lens-dom.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadMediaLensPage } from './helpers/media-lens-dom.js';
import { isCatalogMode } from '../media-lens/media-lens.js';

const LIVE_HREF = 'https://ml-jev.manipulationscore.com/media-lens/';
const LOCAL_HREF = 'http://127.0.0.1:8123/media-lens/';
const LOCAL_ONLY_IDS = ['fixture-explorer', 'input-mode-fieldset', 'sample-analyze'];

function localOnlyElements(page) {
  return page.document.querySelectorAll('[data-local-only]');
}

function fixtureRequests(page) {
  return page.fetchCalls.filter((call) => call.url.includes('fixtures/'));
}

test('catalog mode is only a local preview or an explicit fixture preview', () => {
  const at = (href) => {
    const url = new URL(href);
    return { protocol: url.protocol, hostname: url.hostname };
  };
  assert.equal(isCatalogMode({ location: at('http://localhost:8080/media-lens/') }), true);
  assert.equal(isCatalogMode({ location: at('http://127.0.0.1:8123/media-lens/') }), true);
  assert.equal(isCatalogMode({ location: at('http://[::1]:8123/media-lens/') }), true);
  assert.equal(isCatalogMode({ location: { protocol: 'file:', hostname: '' } }), true);
  assert.equal(isCatalogMode({ location: at(LIVE_HREF) }), false);
  assert.equal(isCatalogMode({ location: at('https://media-lens-git-branch.vercel.app/media-lens/') }), false);
  assert.equal(isCatalogMode({ location: at('https://manipulationscore.com/media-lens/') }), false);
  assert.equal(isCatalogMode({ location: at(LIVE_HREF), fixturePreview: true }), true);
});

test('static HTML hides every local-only control before the script runs', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const tags = [...html.matchAll(/<[a-z]+\b[^>]*\bdata-local-only\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length >= 4, 'expected the explorer, fieldset, sample open button, and sample analyze button');
  for (const tag of tags) assert.match(tag, /\shidden(?:[\s>=])/, tag);
  for (const id of LOCAL_ONLY_IDS) {
    assert.match(html, new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*\\bdata-local-only\\b[^>]*\\shidden`), id);
  }
  assert.match(html, /data-fixture-id="synthetic-01-quoted-vs-authorial"[^>]*data-local-only[^>]*hidden/);
  assert.doesNotMatch(html, /data-local-only="/, 'data-local-only is a boolean selector, not a value');
});

test('live host: no fixture catalog, no fixture request, and the #story= deep link is cleared', async () => {
  const page = await loadMediaLensPage({ href: `${LIVE_HREF}#story=synthetic-02-syndicated-cluster` });
  try {
    for (const el of localOnlyElements(page)) assert.equal(el.hidden, true, el.id || el.tagName);
    assert.equal(page.byId('fixture-explorer').isRendered(), false);
    assert.equal(page.byId('fixture-lanes').children.length, 0);
    assert.equal(page.byId('story-results').innerHTML, '');
    assert.deepEqual(fixtureRequests(page), []);
    assert.deepEqual(page.historyCalls, ['/media-lens/']);
    assert.equal(page.window.location.hash, '');
    assert.deepEqual(
      page.fetchCalls.map((call) => `${call.method} ${call.url}`),
      ['GET https://ml-jev.manipulationscore.com/health']
    );
    // The static sample card stays visible and labeled as a made-up example.
    const sample = page.byId('ml-sample-heading');
    assert.equal(sample.isRendered(), true);
    assert.equal(sample.tagName, 'H3');
    // Fixture and pasted text can never be selected on the live host.
    const fixtureRadio = page.document.querySelector('input[name="input-mode"][value="fixture"]');
    const pastedRadio = page.document.querySelector('input[name="input-mode"][value="pasted_text"]');
    assert.equal(fixtureRadio.disabled, true);
    assert.equal(pastedRadio.disabled, true);
    assert.equal(page.byId('input-mode-fieldset').hidden, true);
    assert.equal(page.byId('article-url').disabled, false, 'live URL input is enabled once /health is ready');
    // A programmatic click on the hidden sample button still requests nothing.
    page.document.querySelector('[data-fixture-id]').click();
    await page.flush();
    assert.deepEqual(fixtureRequests(page), []);
    assert.equal(page.byId('results').hidden, true);
  } finally {
    page.restore();
  }
});

test('any other non-local origin behaves like the live host', async () => {
  const page = await loadMediaLensPage({ href: 'https://media-lens-preview.vercel.app/media-lens/#story=synthetic-01-quoted-vs-authorial' });
  try {
    for (const el of localOnlyElements(page)) assert.equal(el.hidden, true, el.id || el.tagName);
    assert.deepEqual(fixtureRequests(page), []);
    assert.equal(page.window.location.hash, '');
  } finally {
    page.restore();
  }
});

test('catalog mode reveals the explorer, keeps lanes and search, and opens a fixture from the deep link', async () => {
  const page = await loadMediaLensPage({ href: `${LOCAL_HREF}#story=synthetic-02-syndicated-cluster`, health: null });
  try {
    for (const el of localOnlyElements(page)) assert.equal(el.hidden, false, el.id || el.tagName);
    assert.equal(page.byId('fixture-lanes').children.length, 4);
    assert.match(page.byId('story-results').innerHTML, /Regional transit agency proposes fare increase/);
    assert.deepEqual(
      fixtureRequests(page).map((call) => call.url),
      ['./fixtures/expected/synthetic-02-syndicated-cluster.graph.json']
    );
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(page.byId('result-kicker').textContent, 'Fixture story workspace');
    assert.equal(page.byId('coverage-comparison').hidden, false);
    assert.equal(page.byId('coverage-not-run').hidden, true);
    assert.match(page.byId('compare-status').textContent, /Fixture comparison only\.$/);
    assert.equal(page.document.activeElement, page.byId('result-title'));
  } finally {
    page.restore();
  }
});

test('catalog fixture buttons have unique accessible names', async () => {
  const page = await loadMediaLensPage({ href: LOCAL_HREF, health: null });
  try {
    const cards = page.byId('story-results').innerHTML;
    const labels = [...cards.matchAll(/data-fixture-id="[^"]+" aria-label="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 6);
    const sample = page.document.querySelector('[data-fixture-id]');
    const names = [...labels, sample._text.trim()];
    assert.equal(new Set(names).size, names.length, names.join(' | '));
    for (const label of labels) assert.match(label, /^Open fixture workspace for /);
    assert.equal(sample._text.trim(), 'Open sample in fixture workspace');
  } finally {
    page.restore();
  }
});
