// Versioned classifier.dev escalation taxonomy loader.
// Labels are evaluation-only. They are not outlet/person verdicts, not
// factual verification, and not a second independent Media Lens model.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from '../jev/canonical-json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TAXONOMY_PATH = join(__dirname, 'taxonomy.v1.json');
export const TAXONOMY_VERSION_ID = 'cdev-taxonomy-1.0.0';

export const CDEV_LABEL_IDS = Object.freeze([
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
]);

export const ABSTENTION_LABEL_IDS = Object.freeze(['insufficient_evidence', 'human_review_required']);
export const SIGNAL_LABEL_IDS = Object.freeze(CDEV_LABEL_IDS.filter((id) => !ABSTENTION_LABEL_IDS.includes(id)));

const REQUIRED_LABEL_FIELDS = [
  'id',
  'version_id',
  'concept_family',
  'definition',
  'positive_examples',
  'negative_examples',
  'exclusion_rules',
  'evidence_requirements',
  'abstention_conditions'
];

let cached = null;

export function validateTaxonomyDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('taxonomy.v1.json must be an object');
  }
  if (doc.version_id !== TAXONOMY_VERSION_ID) {
    throw new Error(`taxonomy version_id must be ${TAXONOMY_VERSION_ID}`);
  }
  if (doc.schema !== 'media-lens-cdev-taxonomy.v1') {
    throw new Error('taxonomy schema must be media-lens-cdev-taxonomy.v1');
  }
  if (doc.evaluation_only !== true) {
    throw new Error('taxonomy must be marked evaluation_only');
  }
  if (!Array.isArray(doc.kept_separate) || doc.kept_separate.length < 5) {
    throw new Error('taxonomy must record kept-separate concept rules');
  }
  const labels = doc.labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error('taxonomy.labels must be an object');
  }
  const ids = Object.keys(labels);
  if (ids.length !== CDEV_LABEL_IDS.length) {
    throw new Error('taxonomy.labels must contain exactly the documented label set');
  }
  for (const id of CDEV_LABEL_IDS) {
    const label = labels[id];
    if (!label) throw new Error(`missing taxonomy label ${id}`);
    for (const field of REQUIRED_LABEL_FIELDS) {
      if (label[field] == null) throw new Error(`taxonomy label ${id} missing ${field}`);
    }
    if (label.id !== id) throw new Error(`taxonomy label ${id} id mismatch`);
    if (label.version_id !== TAXONOMY_VERSION_ID) {
      throw new Error(`taxonomy label ${id} version_id mismatch`);
    }
    if (typeof label.definition !== 'string' || label.definition.length < 20) {
      throw new Error(`taxonomy label ${id} definition is too short`);
    }
    for (const listField of ['positive_examples', 'negative_examples', 'exclusion_rules', 'evidence_requirements', 'abstention_conditions']) {
      if (!Array.isArray(label[listField]) || label[listField].length < 1) {
        throw new Error(`taxonomy label ${id}.${listField} must be a non-empty array`);
      }
      for (const item of label[listField]) {
        if (typeof item !== 'string' || item.length === 0) {
          throw new Error(`taxonomy label ${id}.${listField} must contain strings`);
        }
      }
    }
  }
  return Object.freeze([...CDEV_LABEL_IDS]);
}

export async function loadClassifierDevTaxonomy() {
  if (cached) return cached;
  const raw = await readFile(TAXONOMY_PATH, 'utf8');
  const document = JSON.parse(raw);
  validateTaxonomyDocument(document);
  const sha256 = createHash('sha256').update(canonicalStringify(document), 'utf8').digest('hex');
  cached = Object.freeze({
    document,
    ids: CDEV_LABEL_IDS,
    versionId: TAXONOMY_VERSION_ID,
    sha256,
    evaluationOnly: true
  });
  return cached;
}

export function isAbstentionLabel(id) {
  return ABSTENTION_LABEL_IDS.includes(id);
}
