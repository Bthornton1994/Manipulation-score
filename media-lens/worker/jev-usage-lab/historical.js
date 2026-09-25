// Replay recorded fixture answers against expected-graph observations.
//
// Reads answer objects and observation rows only. It does not copy span
// text into the shadow record and it does not call Jev. Marker-gated
// signals fail closed to candidate when the span text is not in the log,
// which matches fusion.js when the deterministic marker is absent.

import { readFile } from 'node:fs/promises';
import {
  CURRENT_SIGNAL_OPTIONS,
  buildDecisionRecord,
  buildQuotedNoulRecord,
  deriveEvidenceStrength,
  applyObservedSafety
} from './decision.js';

export function productionInfluenceQuestionSet() {
  const criteria = {};
  const appMapping = {};
  for (const id of CURRENT_SIGNAL_OPTIONS) {
    criteria[id] = id;
    appMapping[id] = id === 'none' ? 'no_signal' : 'influence_signal';
  }
  return {
    id: 'influence-questions.v1',
    version: '1',
    model_requested: 'jev-1.13.0',
    questions: {
      influence_signal: {
        type: 'choice',
        send_to_jev: true,
        policy: 'standard',
        criteria,
        app_mapping: appMapping
      },
      is_quoted_or_attributed: {
        type: 'noul',
        send_to_jev: true,
        policy: 'standard',
        criteria: { true: 'quoted or attributed', false: 'authorial or unattributed' },
        app_mapping: {}
      }
    }
  };
}

export function jevObservationsFromGraph(graph) {
  const rows = [];
  for (const observation of graph?.observations || []) {
    if (observation?.evidence?.engine !== 'jev') continue;
    const spanId = Array.isArray(observation.span_ids) ? observation.span_ids[0] : null;
    if (typeof spanId !== 'string') continue;
    rows.push({
      span_id: spanId,
      signal: observation.signal,
      strength: observation.strength
    });
  }
  return rows;
}

export function preJevRoleBySpan(graph) {
  const roles = new Map();
  for (const span of graph?.spans || []) {
    if (!span?.id) continue;
    if (span.role_basis === 'engine_disagreement') roles.set(span.id, 'authorial');
    else if (typeof span.role === 'string') roles.set(span.id, span.role);
  }
  return roles;
}

function emissionFromAnswer(answer, deterministicMarker) {
  const choice = answer?.influence_signal?.choice;
  if (typeof choice !== 'string') return { signal: null, strength: null };
  if (choice === 'none') return { signal: 'none', strength: null };
  const probability = answer.influence_signal?.probabilities?.[choice];
  let strength = deriveEvidenceStrength(probability);
  strength = applyObservedSafety({ choice, strength, deterministicMarker });
  if (strength == null || strength === 'below_threshold') return { signal: 'none', strength: null };
  return { signal: choice, strength };
}

export function compareProductionAnswerToObservation({
  fixtureId,
  spanId,
  answer,
  observation,
  spanRole,
  sourceId,
  questionSet,
  audit,
  deterministicMarker = null
}) {
  const expected = emissionFromAnswer(answer, deterministicMarker);
  const historical = observation
    ? { signal: observation.signal, strength: observation.strength }
    : { signal: 'none', strength: null };
  const signalMatch = expected.signal === historical.signal;
  const strengthMatch = expected.strength === historical.strength;
  const disagreement = !signalMatch || !strengthMatch;
  const label = {
    option: expected.signal === 'none' ? 'none' : observation?.signal || 'none',
    outcome_class: disagreement ? 'historical_mismatch' : 'historical_match',
    historical_action: observation ? `${observation.signal}:${observation.strength}` : 'no_jev_observation'
  };
  // A sentinel label forces the decision record's disagreement bit to follow
  // signal-and-strength comparison, including the case where the class
  // matches but the strength does not. The sentinel is not stored.
  const influence = buildDecisionRecord({
    questionSet,
    questionId: 'influence_signal',
    answer: answer?.influence_signal,
    provenance: {
      article_id: fixtureId,
      source_id: sourceId,
      span_id: spanId,
      span_role: spanRole || null
    },
    audit,
    requireCompleteDistribution: false,
    deterministicMarker,
    minMargin: 0,
    label: disagreement
      ? { option: '__historical__', outcome_class: 'historical_mismatch', historical_action: label.historical_action }
      : { option: answer?.influence_signal?.choice || null, outcome_class: 'historical_match', historical_action: label.historical_action }
  });
  const roleEffectExpected = spanRole === 'authorial' && typeof answer?.is_quoted_or_attributed?.noul === 'number' && answer.is_quoted_or_attributed.noul >= 0.7
    ? 'authorial_to_uncertain'
    : 'none';
  const quoted = buildQuotedNoulRecord({
    questionSet,
    answer: answer?.is_quoted_or_attributed,
    provenance: {
      article_id: fixtureId,
      source_id: sourceId,
      span_id: spanId,
      span_role: spanRole || null
    },
    audit,
    label: {
      outcome_class: 'historical_match',
      historical_action: roleEffectExpected
    }
  });
  return {
    fixture_id: fixtureId,
    span_id: spanId,
    disagreement,
    expected,
    historical,
    influence,
    quoted
  };
}

export async function replayHistoricalFixtures({
  pairs,
  audit,
  readText = readFile
}) {
  const questionSet = productionInfluenceQuestionSet();
  const rows = [];
  for (const pair of pairs) {
    const answersDoc = JSON.parse(await readText(pair.answersPath, 'utf8'));
    const graph = JSON.parse(await readText(pair.graphPath, 'utf8'));
    const observations = jevObservationsFromGraph(graph);
    const bySpan = new Map(observations.map((row) => [row.span_id, row]));
    const roles = preJevRoleBySpan(graph);
    const sourceId = graph?.artifact?.publisher?.domain || null;
    const answers = answersDoc?.answers && typeof answersDoc.answers === 'object' ? answersDoc.answers : {};
    for (const spanId of Object.keys(answers).sort()) {
      rows.push(
        compareProductionAnswerToObservation({
          fixtureId: pair.fixtureId,
          spanId,
          answer: answers[spanId],
          observation: bySpan.get(spanId) || null,
          spanRole: roles.get(spanId) || null,
          sourceId: typeof sourceId === 'string' ? sourceId : null,
          questionSet,
          audit: { ...audit, model_reported: answersDoc.model_reported || null }
        })
      );
    }
  }
  const disagreements = rows.filter((row) => row.disagreement).length;
  return {
    rows,
    n: rows.length,
    disagreements,
    network_calls: 0,
    text_included: false
  };
}
