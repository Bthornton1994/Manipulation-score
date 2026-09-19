import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CDEV_LABEL_IDS,
  TAXONOMY_VERSION_ID,
  loadClassifierDevTaxonomy,
  validateTaxonomyDocument,
  isAbstentionLabel
} from '../media-lens/worker/classifier-dev/taxonomy.js';
import { BANNED_PHRASES } from '../media-lens/schema/taxonomy.js';

const REQUIRED_IDS = [
  'emotional_loading',
  'fear_urgency',
  'dehumanization',
  'scapegoating',
  'personal_attack',
  'unsupported_certainty',
  'misleading_omission_candidate',
  'loaded_framing',
  'attribution_quotation_ambiguity',
  'call_to_action_pressure',
  'no_detected_signal',
  'insufficient_evidence',
  'human_review_required'
];

test('versioned taxonomy covers the required labels and keeps concepts separate', async () => {
  const taxonomy = await loadClassifierDevTaxonomy();
  assert.equal(taxonomy.versionId, TAXONOMY_VERSION_ID);
  assert.equal(taxonomy.evaluationOnly, true);
  assert.deepEqual([...taxonomy.ids], REQUIRED_IDS);
  assert.equal(taxonomy.sha256.length, 64);
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('factual verification'));
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('source ownership'));
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('disagreement'));
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('omission'));
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('confidence'));
  assert.ok(taxonomy.document.kept_separate.join(' ').includes('human_review'));

  for (const id of REQUIRED_IDS) {
    const label = taxonomy.document.labels[id];
    assert.equal(label.version_id, TAXONOMY_VERSION_ID);
    assert.ok(label.definition.length > 20);
    assert.ok(label.positive_examples.length >= 1);
    assert.ok(label.negative_examples.length >= 1);
    assert.ok(label.exclusion_rules.length >= 1);
    assert.ok(label.evidence_requirements.length >= 1);
    assert.ok(label.abstention_conditions.length >= 1);
  }
  assert.equal(isAbstentionLabel('human_review_required'), true);
  assert.equal(isAbstentionLabel('emotional_loading'), false);
});

test('taxonomy file matches the committed label set and does not use banned UI phrases', async () => {
  const raw = await readFile('media-lens/worker/classifier-dev/taxonomy.v1.json', 'utf8');
  const doc = JSON.parse(raw);
  assert.deepEqual(validateTaxonomyDocument(doc), CDEV_LABEL_IDS);
  const lower = raw.toLowerCase();
  for (const banned of BANNED_PHRASES) {
    assert.equal(lower.includes(banned), false, `taxonomy must not contain banned phrase ${banned}`);
  }
  assert.doesNotMatch(raw, /untrustworthy outlet|untrustworthy people/i);
});
