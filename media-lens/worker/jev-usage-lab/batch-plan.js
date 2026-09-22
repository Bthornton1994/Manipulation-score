// Plan how independent Jev questions would share requests.
//
// TypeSafe accepts one state and many questions. Question ids are an
// application key; they are not a second span id. This planner therefore
// batches only questions that already share article_id + span_id. It does
// not send HTTP.

import { cleanProvenance } from './decision.js';

function provenanceKey(provenance) {
  if (!provenance?.article_id || !provenance?.span_id) return null;
  const source = provenance.source_id || '';
  return `${provenance.article_id}\u0000${source}\u0000${provenance.span_id}`;
}

/**
 * @param {Array<{ provenance: object, question_ids: string[] }>} items
 * @param {object} questionSet
 */
export function planQuestionBatch(items, questionSet) {
  const groups = new Map();
  const refused = [];
  for (const item of items || []) {
    const provenance = cleanProvenance(item?.provenance);
    const key = provenanceKey(provenance);
    if (!key) {
      refused.push({
        reason: 'missing_provenance',
        question_ids: Array.isArray(item?.question_ids) ? [...item.question_ids] : []
      });
      continue;
    }
    if (!groups.has(key)) groups.set(key, { provenance, question_ids: [] });
    const group = groups.get(key);
    for (const questionId of item.question_ids || []) {
      const question = questionSet?.questions?.[questionId];
      if (!question) {
        refused.push({ reason: 'unknown_question', question_id: questionId, provenance_key: key });
        continue;
      }
      if (question.send_to_jev === false || question.policy === 'derived') {
        refused.push({ reason: 'derived_in_app', question_id: questionId, provenance_key: key });
        continue;
      }
      if (!group.question_ids.includes(questionId)) group.question_ids.push(questionId);
    }
  }

  const requests = [];
  for (const group of groups.values()) {
    if (group.question_ids.length === 0) continue;
    requests.push({
      provenance: group.provenance,
      question_ids: group.question_ids,
      request_count: 1,
      batched_question_count: group.question_ids.length,
      cross_span: false
    });
  }

  return {
    requests,
    refused,
    cross_span_batched: false,
    http_calls: 0,
    tradeoff:
      'Questions that share one article id and span id can share one state, and each answer stays keyed by question id under that provenance. Different spans stay in separate requests because one TypeSafe state cannot attribute answers to more than one span.'
  };
}
