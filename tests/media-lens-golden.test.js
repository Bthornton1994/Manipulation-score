import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { normalizeForGolden } from '../media-lens/schema/golden.js';
import { validate } from '../media-lens/schema/validate.js';

const OFFICIAL_FIXTURE_IDS = [
  'synthetic-01-quoted-vs-authorial',
  'synthetic-02-syndicated-cluster',
  'synthetic-03-no-timestamp',
  'synthetic-04-injection',
  'synthetic-05-paywall',
  'synthetic-06-short-excerpt'
];

for (const fixtureId of OFFICIAL_FIXTURE_IDS) {
  test(`${fixtureId} matches its golden influence-graph.v1 output`, async () => {
    const graph = await runFixture(fixtureId);
    const { valid, errors } = validate(graph);
    assert.deepEqual(errors, []);
    assert.equal(valid, true);

    const normalized = normalizeForGolden(graph);
    const expectedRaw = await readFile(`media-lens/fixtures/expected/${fixtureId}.graph.json`, 'utf8');
    const expected = JSON.parse(expectedRaw);
    assert.deepEqual(normalized, expected);
  });
}

test('every official fixture id has an article, and a golden expected file', async () => {
  for (const fixtureId of OFFICIAL_FIXTURE_IDS) {
    await readFile(`media-lens/fixtures/articles/${fixtureId}.html`, 'utf8');
    await readFile(`media-lens/fixtures/expected/${fixtureId}.graph.json`, 'utf8');
  }
});
