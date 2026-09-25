// Assign article/span groups to one split before the span-abstain gate.
//
// Holdout is used only when every record on that article and span declared
// holdout. A calibration (or other non-holdout) record cannot stay paired
// with a holdout sibling, and the gate never sees both populations at once.

import { applySpanAbstainGate } from './decision.js';

const NON_HOLDOUT_PRECEDENCE = ['calibration', 'adversarial', 'historical'];

export function spanSplitKey(record) {
  const articleId = record?.provenance?.article_id ?? '';
  const spanId = record?.provenance?.span_id ?? '';
  return `${articleId}\u0000${spanId}`;
}

function assignedSplit(declared) {
  if (declared.length === 1) return declared[0];
  for (const name of NON_HOLDOUT_PRECEDENCE) {
    if (declared.includes(name)) return name;
  }
  const nonHoldout = declared.filter((name) => name !== 'holdout').sort();
  if (nonHoldout.length > 0) return nonHoldout[0];
  return 'holdout';
}

export function assignIsolatedSplits(cases) {
  const declaredByKey = new Map();
  for (const item of cases) {
    const key = spanSplitKey(item.record);
    if (!declaredByKey.has(key)) declaredByKey.set(key, new Set());
    declaredByKey.get(key).add(item.split);
  }

  const assignment = new Map();
  const collisions = [];
  for (const [key, declaredSet] of declaredByKey) {
    const declared = [...declaredSet].sort();
    const split = assignedSplit(declared);
    assignment.set(key, split);
    if (declared.length > 1) {
      const separator = key.indexOf('\u0000');
      collisions.push({
        article_id: key.slice(0, separator),
        span_id: key.slice(separator + 1),
        declared_splits: declared,
        assigned_split: split
      });
    }
  }
  collisions.sort((left, right) => left.article_id.localeCompare(right.article_id) || left.span_id.localeCompare(right.span_id));

  const isolated = cases.map((item) => ({
    ...item,
    declared_split: item.declared_split ?? item.split,
    split: assignment.get(spanSplitKey(item.record))
  }));
  return { cases: isolated, collisions };
}

export function gateCasesWithinSplits(cases) {
  const indexesBySplit = new Map();
  cases.forEach((item, index) => {
    if (!indexesBySplit.has(item.split)) indexesBySplit.set(item.split, []);
    indexesBySplit.get(item.split).push(index);
  });

  const next = cases.slice();
  for (const indexes of indexesBySplit.values()) {
    const gated = applySpanAbstainGate(
      indexes.map((index) => cases[index].record),
      indexes.map((index) => cases[index].label ?? null)
    );
    indexes.forEach((index, offset) => {
      next[index] = { ...cases[index], record: gated[offset] };
    });
  }
  return next;
}

export function prepareLabCases(cases) {
  const isolated = assignIsolatedSplits(cases);
  const gated = gateCasesWithinSplits(isolated.cases);
  const reassignedCases = gated.filter((item) => item.declared_split !== item.split).length;
  return {
    cases: gated,
    collisions: isolated.collisions,
    reassigned_cases: reassignedCases,
    gate: 'per_assigned_split'
  };
}
