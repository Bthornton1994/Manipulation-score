import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadQuestionSet } from '../media-lens/worker/adapters/jev.js';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { planQuestionBatch } from '../media-lens/worker/jev-usage-lab/batch-plan.js';
import { routeFromAnswers } from '../media-lens/worker/jev-usage-lab/cos-routing.js';
import {
  CURRENT_SIGNAL_OPTIONS,
  applySpanAbstainGate,
  buildDecisionRecord
} from '../media-lens/worker/jev-usage-lab/decision.js';
import { evaluateLab } from '../media-lens/worker/jev-usage-lab/evaluate.js';
import { loadQuestionSetFile, runUsageLab, COS_QUESTION_SET_PATH } from '../media-lens/worker/jev-usage-lab/run.js';
import { prepareLabCases } from '../media-lens/worker/jev-usage-lab/split-isolation.js';
import { validateContractSchema } from '../media-lens/worker/jev-usage-lab/schema-check.js';
import { isShadowEnabled } from '../media-lens/worker/jev-usage-lab/shadow.js';
import { assertOutputPathAllowed, runCli } from '../scripts/jev-usage-lab.js';

const FIXED_NOW = '2026-09-22T00:00:00.000Z';
const REPORT_PATH = 'docs/jev-usage-lab/09-accuracy-abstention-report.md';

function choiceAnswer(choice, optionIds, probability = 0.9) {
  const others = optionIds.filter((id) => id !== choice);
  const each = others.length ? (1 - probability) / others.length : 0;
  const probabilities = {};
  for (const id of optionIds) probabilities[id] = id === choice ? probability : each;
  return { type: 'choice', choice, probabilities, confidence: probability };
}

async function enabledLab() {
  return runUsageLab({ shadowEnabled: true, deploymentSha: null, now: () => FIXED_NOW });
}

test('shadow flag is exact-true and default off, with zero network records', async () => {
  assert.equal(isShadowEnabled({}), false);
  assert.equal(isShadowEnabled({ MEDIA_LENS_JEV_SHADOW: 'TRUE' }), false);
  assert.equal(isShadowEnabled({ MEDIA_LENS_JEV_SHADOW: 'true' }), true);
  const disabled = await runUsageLab({ now: () => FIXED_NOW });
  assert.equal(disabled.shadow_enabled, false);
  assert.equal(disabled.acted, false);
  assert.equal(disabled.network_calls, 0);
  assert.deepEqual(disabled.records, []);
  assert.equal(disabled.evaluation, null);
});

test('fixture replay matches the committed report and the decision schema', async () => {
  const result = await enabledLab();
  const schema = JSON.parse(await readFile('schemas/jev-decision-contract.v1.json', 'utf8'));
  const committed = await readFile(REPORT_PATH, 'utf8');
  assert.equal(result.report_markdown, committed);
  assert.equal(result.network_calls, 0);
  assert.equal(result.acted, false);
  assert.equal(result.evaluation.thresholds_fit_on_holdout, false);
  assert.equal(result.evaluation.cost.available, false);
  assert.equal(result.evaluation.adversarial.pass, true);
  assert.equal(result.evaluation.calibration.n, 12);
  assert.equal(result.evaluation.calibration.abstained, 5);
  assert.equal(result.evaluation.calibration.scored, 7);
  assert.equal(result.evaluation.calibration.exact_on_non_abstain, 4);
  assert.equal(result.evaluation.calibration.disagreements, 5);
  assert.equal(result.evaluation.calibration.false_positives, 1);
  assert.equal(result.evaluation.calibration.false_negatives, 1);
  assert.equal(result.split_isolation.collisions.length, 0);
  assert.equal(result.split_isolation.reassigned_cases, 0);
  assert.equal(result.split_isolation.gate, 'per_assigned_split');
  assert.equal(result.evaluation.holdout.n, 4);
  assert.equal(result.evaluation.holdout.abstained, 2);
  assert.equal(result.evaluation.holdout.exact_on_non_abstain, 1);
  assert.equal(result.evaluation.holdout.disagreements, 1);
  assert.equal(result.evaluation.holdout.false_negatives, 1);
  assert.equal(result.historical.disagreements, 1);
  assert.match(committed, /Not real-world accuracy/);
  assert.doesNotMatch(committed, /62\.6|95%/);

  for (const record of result.records) {
    assert.deepEqual(validateContractSchema(schema, record), []);
    assert.equal(record.acted, false);
    assert.equal(record.claim_support_applied, false);
    assert.equal(record.role_write_authorized, false);
  }
  for (const row of result.historical.rows) {
    assert.deepEqual(validateContractSchema(schema, row.influence), []);
    assert.deepEqual(validateContractSchema(schema, row.quoted), []);
  }
});

test('shadow records keep provenance ids and drop text, scores, and secrets', async () => {
  const result = await enabledLab();
  const serialized = JSON.stringify({ records: result.records, historical: result.historical });
  assert.doesNotMatch(serialized, /downtown drainage upgrade/);
  assert.doesNotMatch(serialized, /SCORE-SENTINEL-95/);
  assert.doesNotMatch(serialized, /do-not-store/);
  assert.doesNotMatch(serialized, /rank this outlet/);
  assert.doesNotMatch(serialized, /both_and_neither/);
  assert.equal(serialized.includes('sk-'), false);

  const quotation = result.cases.find((item) => item.id === 'lab-cal-quotation-correct').record;
  assert.equal(quotation.provenance.article_id, 'lab-cal-quotation');
  assert.equal(quotation.provenance.span_id, 'span-cal-quotation');
  assert.equal(quotation.selected_option, 'quotation');
  assert.equal(quotation.evidence_strength, 'observed');
  assert.equal(quotation.disagreement, false);
  assert.equal(quotation.mapped_ui_state, 'quoted_not_authorial');

  const candidate = result.cases.find((item) => item.id === 'lab-cal-candidate-strength').record;
  assert.equal(candidate.evidence_strength, 'candidate');
  assert.notEqual(candidate.evidence_strength, 'observed');

  const ambiguous = result.cases.find((item) => item.id === 'lab-cal-ambiguous').record;
  assert.equal(ambiguous.abstained, true);
  assert.equal(ambiguous.abstention_reason, 'low_margin');
  assert.ok(ambiguous.margin < 0.15);
  assert.equal(ambiguous.selected_option, null);
  assert.equal(ambiguous.model_option, 'present');

  const claim = result.cases.find((item) => item.id === 'lab-cal-claim-held').record;
  assert.equal(claim.model_option, 'supported');
  assert.equal(claim.final_action, 'hold_for_human');
  assert.equal(claim.claim_support_applied, false);
  assert.equal(claim.disagreement, true);
  assert.equal(claim.mapped_ui_state, 'hold_unsupported_claim');

  const missingSource = result.cases.find((item) => item.id === 'lab-adv-source-missing').record;
  assert.equal(missingSource.abstained, true);
  assert.equal(missingSource.abstention_reason, 'insufficient_source_context');
  assert.equal(missingSource.model_option, 'independent');
  assert.equal(missingSource.model_disagreement, true);
  assert.equal(missingSource.disagreement, false);

  const questionSet = await loadQuestionSetFile('media-lens/worker/jev-usage-lab/question-sets/media-lens-narrow.v1.json');
  const stripped = buildDecisionRecord({
    questionSet,
    questionId: 'false_dilemma',
    answer: choiceAnswer('absent', Object.keys(questionSet.questions.false_dilemma.criteria)),
    provenance: {
      article_id: 'article-1',
      source_id: 'source-1',
      span_id: 'span-1',
      span_text: 'UNIQUE_SENTINEL_TEXT',
      api_key: 'sk-not-a-real-key'
    },
    audit: { recorded_at: FIXED_NOW, question_set_sha256: questionSet.sha256 },
    label: { option: 'absent', outcome_class: 'correct' }
  });
  assert.equal(JSON.stringify(stripped).includes('UNIQUE_SENTINEL_TEXT'), false);
  assert.equal(JSON.stringify(stripped).includes('sk-not-a-real-key'), false);
  assert.equal(stripped.provenance.span_id, 'span-1');
});

test('historical replay matches stored observations except the paywall answer file', async () => {
  const result = await enabledLab();
  const mismatch = result.evaluation.historical.rows.filter((row) => row.disagreement);
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].fixture_id, 'synthetic-05-paywall');
  assert.equal(mismatch[0].span_id, 'span-3');
  assert.equal(mismatch[0].expected_signal, 'vague_authority');
  assert.equal(mismatch[0].expected_strength, 'candidate');
  assert.equal(mismatch[0].historical_signal, 'none');

  const quotedMove = result.historical.rows.find(
    (row) => row.fixture_id === 'synthetic-01-quoted-vs-authorial' && row.span_id === 'span-7'
  );
  assert.equal(quotedMove.quoted.role_effect, 'authorial_to_uncertain');
  assert.equal(quotedMove.quoted.role_write_authorized, false);
  const quotedAlready = result.historical.rows.find(
    (row) => row.fixture_id === 'synthetic-01-quoted-vs-authorial' && row.span_id === 'span-4'
  );
  assert.equal(quotedAlready.quoted.role_effect, 'none');
});

test('in-span questions batch; cross-span questions do not; derived strength is not sent', async () => {
  const questionSet = await loadQuestionSetFile('media-lens/worker/jev-usage-lab/question-sets/media-lens-narrow.v1.json');
  assert.equal(questionSet.questions.observed_vs_candidate.send_to_jev, false);
  const plan = planQuestionBatch(
    [
      {
        provenance: { article_id: 'article-1', source_id: 'source-1', span_id: 'span-1' },
        question_ids: ['authorial_vs_quotation', 'false_dilemma', 'observed_vs_candidate']
      },
      {
        provenance: { article_id: 'article-1', source_id: 'source-1', span_id: 'span-1' },
        question_ids: ['emotionally_loaded_language']
      },
      {
        provenance: { article_id: 'article-1', source_id: 'source-1', span_id: 'span-2' },
        question_ids: ['false_dilemma']
      },
      { provenance: { article_id: 'article-1' }, question_ids: ['false_dilemma'] }
    ],
    questionSet
  );
  assert.equal(plan.http_calls, 0);
  assert.equal(plan.cross_span_batched, false);
  assert.equal(plan.requests.length, 2);
  const first = plan.requests.find((request) => request.provenance.span_id === 'span-1');
  assert.deepEqual(first.question_ids, ['authorial_vs_quotation', 'false_dilemma', 'emotionally_loaded_language']);
  assert.equal(first.request_count, 1);
  assert.equal(plan.requests.some((request) => request.question_ids.includes('observed_vs_candidate')), false);
  assert.ok(plan.refused.some((row) => row.reason === 'derived_in_app'));
  assert.ok(plan.refused.some((row) => row.reason === 'missing_provenance'));
});

test('two source ids stay candidate and a span abstain suppresses siblings', async () => {
  const questionSet = await loadQuestionSetFile('media-lens/worker/jev-usage-lab/question-sets/media-lens-narrow.v1.json');
  const audit = { recorded_at: FIXED_NOW, question_set_sha256: questionSet.sha256 };
  const source = buildDecisionRecord({
    questionSet,
    questionId: 'source_independence',
    answer: choiceAnswer('independent', Object.keys(questionSet.questions.source_independence.criteria), 0.8),
    provenance: {
      article_id: 'article-2',
      source_id: 'source-a',
      source_ids: ['source-a', 'source-b'],
      span_id: 'span-9'
    },
    audit
  });
  assert.equal(source.abstained, false);
  assert.equal(source.selected_option, 'independent');
  assert.equal(source.evidence_strength, 'candidate');
  assert.equal(source.mapped_ui_state, 'coverage_candidate');

  const provenance = { article_id: 'article-3', source_id: 'source-a', span_id: 'span-3' };
  const abstain = buildDecisionRecord({
    questionSet,
    questionId: 'should_abstain',
    answer: choiceAnswer('abstain', ['abstain', 'answer']),
    provenance,
    audit
  });
  const loaded = buildDecisionRecord({
    questionSet,
    questionId: 'emotionally_loaded_language',
    answer: choiceAnswer('loaded_moralized', ['loaded_moralized', 'not_loaded', 'abstain']),
    provenance,
    audit
  });
  const siblingLabel = { option: 'present', outcome_class: 'abstention', historical_action: 'abstain' };
  const dilemma = buildDecisionRecord({
    questionSet,
    questionId: 'false_dilemma',
    answer: choiceAnswer('present', ['present', 'absent', 'abstain']),
    provenance,
    audit,
    label: siblingLabel
  });
  const labels = [
    { option: 'abstain', outcome_class: 'abstention', historical_action: 'abstain' },
    { option: 'loaded_moralized', outcome_class: 'abstention', historical_action: 'abstain' },
    siblingLabel
  ];
  const gated = applySpanAbstainGate([abstain, loaded, dilemma], labels);
  assert.equal(gated[1].suppressed_by_span_abstain, true);
  assert.equal(gated[1].abstained, true);
  assert.equal(gated[1].selected_option, null);
  assert.equal(gated[1].evidence_strength, null);
  assert.equal(gated[1].mapped_ui_state, 'abstain');
  assert.equal(gated[1].final_action, 'shadow_abstain');
  assert.equal(gated[1].abstention_reason, 'span_abstain');
  assert.equal(gated[1].policy_override, 'span_abstain');
  assert.equal(gated[1].acted, false);
  assert.equal(gated[1].claim_support_applied, false);
  assert.equal(gated[1].role_write_authorized, false);
  assert.equal(gated[1].model_option, 'loaded_moralized');
  assert.equal(gated[1].model_disagreement, false);
  assert.equal(gated[1].disagreement, true);
  assert.equal(gated[2].abstained, true);
  assert.equal(gated[2].selected_option, null);
  assert.equal(gated[2].suppressed_by_span_abstain, true);
  assert.equal(gated[2].disagreement, true);
  assert.equal(gated[2].evidence_strength, null);
  assert.equal(gated[0].suppressed_by_span_abstain, false);
  assert.equal(gated[0].abstention_reason, 'explicit_abstain');

  const evaluation = evaluateLab({
    questionSet,
    cases: [
      { id: 'abstain', split: 'calibration', label: labels[0], record: gated[0] },
      { id: 'loaded', split: 'calibration', label: labels[1], record: gated[1] },
      { id: 'dilemma', split: 'calibration', label: labels[2], record: gated[2] }
    ]
  });
  assert.equal(evaluation.calibration.n, 3);
  assert.equal(evaluation.calibration.abstained, 3);
  assert.equal(evaluation.calibration.scored, 0);
  assert.equal(evaluation.calibration.exact_on_non_abstain, 0);
  assert.equal(evaluation.calibration.false_positives, 0);
  assert.equal(evaluation.calibration.false_negatives, 0);
  assert.equal(evaluation.holdout.n, 0);

  const poisoned = evaluateLab({
    questionSet,
    cases: [
      {
        id: 'poisoned',
        split: 'holdout',
        label: labels[1],
        record: {
          ...gated[1],
          abstained: false,
          selected_option: 'loaded_moralized',
          disagreement: false,
          suppressed_by_span_abstain: true
        }
      }
    ]
  });
  assert.equal(poisoned.holdout.scored, 0);
  assert.equal(poisoned.holdout.abstained, 1);
  assert.equal(poisoned.holdout.exact_on_non_abstain, 0);
  assert.equal(poisoned.holdout.false_positives, 0);
});

test('shared article and span ids stay in one split and cannot change holdout', async () => {
  const questionSet = await loadQuestionSetFile('media-lens/worker/jev-usage-lab/question-sets/media-lens-narrow.v1.json');
  const audit = { recorded_at: FIXED_NOW, question_set_sha256: questionSet.sha256 };
  const shared = { article_id: 'article-shared', source_id: 'source-a', span_id: 'span-shared' };
  const abstain = buildDecisionRecord({
    questionSet,
    questionId: 'should_abstain',
    answer: choiceAnswer('abstain', ['abstain', 'answer']),
    provenance: shared,
    audit,
    label: { option: 'abstain', outcome_class: 'abstention' }
  });
  const sibling = buildDecisionRecord({
    questionSet,
    questionId: 'emotionally_loaded_language',
    answer: choiceAnswer('loaded_moralized', ['loaded_moralized', 'not_loaded', 'abstain']),
    provenance: shared,
    audit,
    label: { option: 'loaded_moralized', outcome_class: 'correct' }
  });
  const holdoutOther = buildDecisionRecord({
    questionSet,
    questionId: 'authorial_vs_quotation',
    answer: choiceAnswer('authorial', ['authorial', 'quotation', 'attributed_paraphrase', 'uncertain']),
    provenance: { article_id: 'article-holdout-only', source_id: 'source-a', span_id: 'span-holdout-only' },
    audit,
    label: { option: 'authorial', outcome_class: 'correct' }
  });

  function labCase(id, split, record, label) {
    return { id, split, label, record, expect: null, forbidden_substrings: null };
  }

  const mixed = [
    labCase('cal-abstain', 'calibration', abstain, { option: 'abstain', outcome_class: 'abstention' }),
    labCase('hold-sibling', 'holdout', sibling, { option: 'loaded_moralized', outcome_class: 'correct' }),
    labCase('hold-other', 'holdout', holdoutOther, { option: 'authorial', outcome_class: 'correct' })
  ];
  const first = prepareLabCases(mixed);
  const second = prepareLabCases(mixed);
  assert.deepEqual(first.collisions, second.collisions);
  assert.deepEqual(
    first.cases.map((item) => item.split),
    second.cases.map((item) => item.split)
  );
  assert.equal(first.collisions.length, 1);
  assert.equal(first.collisions[0].assigned_split, 'calibration');
  assert.deepEqual(first.collisions[0].declared_splits, ['calibration', 'holdout']);
  assert.equal(first.cases.find((item) => item.id === 'cal-abstain').split, 'calibration');
  assert.equal(first.cases.find((item) => item.id === 'hold-sibling').split, 'calibration');
  assert.equal(first.cases.find((item) => item.id === 'hold-other').split, 'holdout');

  const splitsByKey = new Map();
  for (const item of first.cases) {
    const key = `${item.record.provenance.article_id}\u0000${item.record.provenance.span_id}`;
    if (!splitsByKey.has(key)) splitsByKey.set(key, new Set());
    splitsByKey.get(key).add(item.split);
  }
  for (const splits of splitsByKey.values()) assert.equal(splits.size, 1);

  const moved = first.cases.find((item) => item.id === 'hold-sibling').record;
  assert.equal(moved.abstained, true);
  assert.equal(moved.selected_option, null);
  assert.equal(moved.suppressed_by_span_abstain, true);
  assert.equal(moved.final_action, 'shadow_abstain');
  const untouched = first.cases.find((item) => item.id === 'hold-other').record;
  assert.equal(untouched.suppressed_by_span_abstain, false);
  assert.equal(untouched.abstained, false);
  assert.equal(untouched.selected_option, 'authorial');

  const alone = prepareLabCases([mixed[2]]);
  assert.deepEqual(untouched, alone.cases[0].record);

  const siblingAlone = prepareLabCases([mixed[1]]);
  assert.equal(siblingAlone.cases[0].split, 'holdout');
  assert.equal(siblingAlone.cases[0].record.abstained, false);
  assert.equal(siblingAlone.cases[0].record.selected_option, 'loaded_moralized');
  assert.equal(siblingAlone.cases[0].record.suppressed_by_span_abstain, false);

  const evaluation = evaluateLab({ questionSet, cases: first.cases, splitIsolation: first });
  assert.equal(evaluation.holdout.n, 1);
  assert.equal(evaluation.holdout.scored, 1);
  assert.equal(evaluation.holdout.exact_on_non_abstain, 1);
  assert.equal(evaluation.holdout.abstained, 0);
  assert.equal(evaluation.calibration.n, 2);
  assert.equal(evaluation.calibration.scored, 0);
  assert.equal(evaluation.calibration.exact_on_non_abstain, 0);
  assert.equal(evaluation.calibration.abstained, 2);

  const result = await enabledLab();
  const siblings = result.cases.filter((item) => item.record.provenance.span_id === 'span-cal-siblings');
  assert.equal(siblings.length, 3);
  assert.equal(new Set(siblings.map((item) => item.split)).size, 1);
  const loadedSibling = siblings.find((item) => item.id === 'lab-cal-span-siblings-loaded').record;
  const dilemmaSibling = siblings.find((item) => item.id === 'lab-cal-span-siblings-dilemma').record;
  const abstainSibling = siblings.find((item) => item.id === 'lab-cal-span-siblings-abstain').record;
  assert.equal(loadedSibling.abstained, true);
  assert.equal(loadedSibling.selected_option, null);
  assert.equal(loadedSibling.evidence_strength, null);
  assert.equal(loadedSibling.model_option, 'loaded_moralized');
  assert.equal(loadedSibling.disagreement, true);
  assert.equal(dilemmaSibling.abstained, true);
  assert.equal(dilemmaSibling.selected_option, null);
  assert.equal(dilemmaSibling.model_option, 'present');
  assert.equal(abstainSibling.suppressed_by_span_abstain, false);
  assert.equal(abstainSibling.abstention_reason, 'explicit_abstain');
  for (const row of result.historical.rows) {
    assert.equal(row.influence.suppressed_by_span_abstain, false);
    assert.equal(row.quoted.suppressed_by_span_abstain, false);
  }
});

test('CoS stub never authorizes merge, deploy, spend, credentials, or live flags', async () => {
  const questionSet = await loadQuestionSetFile(COS_QUESTION_SET_PATH);
  const provenance = { article_id: 'task-1', source_id: 'manipulation-score', span_id: 'route-1' };
  const audit = { recorded_at: FIXED_NOW, question_set_sha256: questionSet.sha256 };

  function answers(overrides) {
    const built = {};
    for (const [questionId, question] of Object.entries(questionSet.questions)) {
      const optionIds = Object.keys(question.criteria);
      const choice = overrides[questionId] || optionIds[0];
      built[questionId] = choiceAnswer(choice, optionIds);
    }
    return built;
  }

  const clear = routeFromAnswers({
    questionSet,
    provenance,
    audit,
    answersByQuestion: answers({
      task_category: 'docs',
      repo_product: 'media_lens',
      external_write_required: 'no',
      reversible: 'reversible',
      bryant_approval_required: 'not_required',
      enough_context: 'enough',
      route_decision: 'route'
    })
  });
  assert.equal(clear.decision.recommendation, 'route');
  assert.equal(clear.decision.executed, false);
  assert.equal(clear.decision.acted, false);
  assert.deepEqual(clear.decision.authorizations, {
    merge: false,
    deploy: false,
    spend: false,
    credentials: false,
    live_flags: false
  });

  const external = routeFromAnswers({
    questionSet,
    provenance,
    audit,
    answersByQuestion: answers({
      external_write_required: 'yes',
      reversible: 'reversible',
      bryant_approval_required: 'not_required',
      enough_context: 'enough',
      route_decision: 'route'
    })
  });
  assert.equal(external.decision.recommendation, 'escalate');
  assert.equal(external.decision.executed, false);

  const clarify = routeFromAnswers({
    questionSet,
    provenance,
    audit,
    answersByQuestion: answers({
      external_write_required: 'no',
      reversible: 'reversible',
      bryant_approval_required: 'not_required',
      enough_context: 'missing',
      route_decision: 'route'
    })
  });
  assert.equal(clarify.decision.recommendation, 'clarify');
  assert.equal(clarify.decision.executed, false);

  const irreversibleAndMissing = routeFromAnswers({
    questionSet,
    provenance,
    audit,
    answersByQuestion: answers({
      external_write_required: 'no',
      reversible: 'irreversible',
      bryant_approval_required: 'required',
      enough_context: 'missing',
      route_decision: 'route'
    })
  });
  assert.equal(irreversibleAndMissing.decision.recommendation, 'escalate');
  assert.equal(irreversibleAndMissing.decision.executed, false);
});

test('production question options stay aligned and analyze() call count is unchanged', async () => {
  const loaded = await loadQuestionSet();
  assert.deepEqual([...loaded.optionIds], [...CURRENT_SIGNAL_OPTIONS]);
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  assert.equal(graph.engine.jev.calls, 6);
  assert.equal(graph.engine.jev.mode, 'fixture');
  assert.equal(graph.claims.every((claim) => claim.support === 'not_checked'), true);
});

test('production fusion and analyze() do not import the usage lab', async () => {
  for (const file of ['media-lens/worker/analyze.js', 'media-lens/worker/adapters/jev.js', 'media-lens/worker/fusion.js']) {
    const source = await readFile(file, 'utf8');
    assert.equal(source.includes('jev-usage-lab'), false, file);
    assert.equal(source.includes('MEDIA_LENS_JEV_SHADOW'), false, file);
  }
  const configSource = await readFile('media-lens/worker/config.js', 'utf8');
  assert.equal(configSource.includes('MEDIA_LENS_JEV_SHADOW'), true);
  assert.equal(configSource.includes('jev-usage-lab'), false);
  const serverSource = await readFile('media-lens/worker/server.js', 'utf8');
  assert.equal(serverSource.includes('jev-usage-lab/analyze-shadow.js'), true);
  assert.equal(serverSource.includes('MEDIA_LENS_JEV_SHADOW'), false);
  assert.equal(serverSource.includes('final_action'), false);
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
  }
  const labFiles = await walk('media-lens/worker/jev-usage-lab');
  assert.ok(labFiles.length > 0);
  for (const file of labFiles) {
    const source = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.equal(source.includes('process.env'), false, relative('.', file));
  }
});

test('CLI stays off without the flag, replays without network when on, and refuses live output under docs', async () => {
  let offText = '';
  const off = await runCli([], { MEDIA_LENS_JEV_SHADOW: 'false' }, { stdout: (chunk) => (offText += chunk), stderr() {} });
  assert.equal(off.status, 0);
  assert.equal(JSON.parse(offText).shadow_enabled, false);
  assert.equal(JSON.parse(offText).network_calls, 0);

  let onText = '';
  const on = await runCli(
    [],
    { MEDIA_LENS_JEV_SHADOW: 'true' },
    { stdout: (chunk) => (onText += chunk), stderr() {}, now: () => FIXED_NOW }
  );
  const summary = JSON.parse(onText);
  assert.equal(on.status, 0);
  assert.equal(summary.shadow_enabled, true);
  assert.equal(summary.acted, false);
  assert.equal(summary.network_calls, 0);
  assert.equal(summary.cost_available, false);
  assert.equal(summary.holdout.untouched, true);
  assert.equal(summary.adversarial_pass, true);

  let err = '';
  const live = await runCli(['--live'], { MEDIA_LENS_JEV_SHADOW: 'true' }, { stdout() {}, stderr: (chunk) => (err += chunk) });
  assert.equal(live.status, 2);
  assert.match(err, /refuses live network/);

  assert.throws(() => assertOutputPathAllowed('docs/jev-usage-lab/not-allowed.md', process.cwd()), /docs/);
  const dest = await mkdtemp(join(tmpdir(), 'jev-usage-lab-'));
  const outPath = join(dest, 'report.md');
  const written = await runCli(['--out', outPath], { MEDIA_LENS_JEV_SHADOW: 'true' }, { stdout() {}, stderr() {}, now: () => FIXED_NOW });
  assert.equal(written.status, 0);
  const body = await readFile(outPath, 'utf8');
  assert.match(body, /Fixture replay only/);
  assert.doesNotMatch(body, /downtown drainage upgrade/);
});
