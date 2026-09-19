import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { validate } from '../media-lens/schema/validate.js';
import {
  CASCADE_POLICY_VERSION,
  applyCascadeDispositions,
  areCloseProbabilities,
  calibrationSupported,
  canonicalDecision,
  decideDisposition,
  labelsAgree,
  minimumSpanText,
  runSelectiveCascade,
  shouldEscalate
} from '../media-lens/worker/classifier-dev/cascade.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { JEV_SIGNAL_QUESTION_ID, JEV_QUOTED_QUESTION_ID } from '../media-lens/worker/adapters/jev.js';

function jevAnswers({ choice, confidence, noul = 0.1, probabilities }) {
  return {
    [JEV_SIGNAL_QUESTION_ID]: {
      type: 'choice',
      choice,
      confidence,
      probabilities: probabilities || { [choice]: confidence, none: Math.max(0, 1 - confidence) }
    },
    [JEV_QUOTED_QUESTION_ID]: { type: 'noul', noul }
  };
}

test('agreement mapping treats related Jev and classifier.dev labels as the same family', () => {
  assert.equal(labelsAgree('none', 'no_detected_signal'), true);
  assert.equal(labelsAgree('urgency', 'fear_urgency'), true);
  assert.equal(labelsAgree('loaded_moralized', 'emotional_loading'), true);
  assert.equal(labelsAgree('certainty_beyond_evidence', 'unsupported_certainty'), true);
  assert.equal(labelsAgree('none', 'personal_attack'), false);
  assert.equal(labelsAgree('urgency', 'insufficient_evidence'), false);
});

test('escalation fires only for low confidence, invalid, close probabilities, conflict, or high-impact', () => {
  const span = { id: 'span-1', role: 'authorial', text: 'The committee met on Tuesday.' };
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'ok' },
      jevAnswers: jevAnswers({ choice: 'none', confidence: 0.92 })
    }).escalate,
    false
  );
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'review' },
      jevAnswers: jevAnswers({ choice: 'none', confidence: 0.4 })
    }).reason,
    'low_confidence'
  );
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'unavailable' },
      jevAnswers: null
    }).reason,
    'invalid'
  );
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'ok' },
      jevAnswers: jevAnswers({
        choice: 'urgency',
        confidence: 0.81,
        probabilities: { urgency: 0.41, fear_threat: 0.4, none: 0.19 }
      })
    }).reason,
    'close_probabilities'
  );
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'ok' },
      jevAnswers: jevAnswers({ choice: 'fear_threat', confidence: 0.9 })
    }).reason,
    'high_impact_review'
  );
  assert.equal(
    shouldEscalate({
      span,
      jevDisposition: { status: 'ok' },
      jevAnswers: jevAnswers({ choice: 'none', confidence: 0.9, noul: 0.8 })
    }).reason,
    'deterministic_conflict'
  );
  assert.equal(areCloseProbabilities({ a: 0.5, b: 0.49 }), true);
});

test('agreement is calibrated only when supported; disagreement and unavailability are explicit', () => {
  assert.equal(
    decideDisposition({
      jevChoice: 'none',
      jevConfidence: 0.9,
      cdev: { ok: true, label: 'no_detected_signal', confidence: 0.88, modelMatch: true, model: 'jev-1.13.0' }
    }).disposition,
    'agree_calibrated'
  );
  assert.equal(
    decideDisposition({
      jevChoice: 'none',
      jevConfidence: 0.9,
      cdev: { ok: true, label: 'personal_attack', confidence: 0.8, modelMatch: true, model: 'jev-1.13.0' }
    }).disposition,
    'disagree_review'
  );
  assert.equal(
    decideDisposition({
      jevChoice: 'none',
      jevConfidence: 0.9,
      cdev: { ok: false, reason: 'timeout' }
    }).disposition,
    'unavailable'
  );
  assert.equal(
    calibrationSupported({
      jevChoice: 'none',
      cdevLabel: 'no_detected_signal',
      jevConfidence: 0.4,
      cdevConfidence: 0.9,
      cdevOk: true,
      modelMatch: true,
      model: 'jev-1.13.0'
    }),
    false
  );
});

test('unknown or mixed models never produce agree_calibrated; pinned jev-1.13.0 still can', () => {
  const unknown = decideDisposition({
    jevChoice: 'none',
    jevConfidence: 0.9,
    cdev: { ok: true, label: 'no_detected_signal', confidence: 0.88, modelMatch: true, model: 'mystery-llm' }
  });
  assert.equal(unknown.disposition, 'disagree_review');
  assert.equal(unknown.calibrated, false);
  assert.equal(unknown.escalateReason, 'unknown_model');
  assert.equal(
    calibrationSupported({
      jevChoice: 'none',
      cdevLabel: 'no_detected_signal',
      jevConfidence: 0.9,
      cdevConfidence: 0.88,
      cdevOk: true,
      modelMatch: true,
      model: 'mystery-llm'
    }),
    false
  );
  assert.equal(
    decideDisposition({
      jevChoice: 'none',
      jevConfidence: 0.9,
      cdev: { ok: true, label: 'no_detected_signal', confidence: 0.88, modelMatch: false, model: 'mixed' }
    }).disposition,
    'disagree_review'
  );
  assert.equal(
    decideDisposition({
      jevChoice: 'none',
      jevConfidence: 0.9,
      cdev: { ok: true, label: 'no_detected_signal', confidence: 0.88, modelMatch: true, model: 'jev-1.13.0' }
    }).disposition,
    'agree_calibrated'
  );
});

test('cascade is deterministic for the same inputs, versions, and policy', async () => {
  const span = { id: 'span-1', role: 'authorial', text: 'Act before midnight or there will be no time left to check.' };
  const answers = jevAnswers({ choice: 'urgency', confidence: 0.55 });
  const jevResult = {
    answersBySpanId: new Map([['span-1', answers]]),
    dispositionsBySpanId: new Map([['span-1', { status: 'review', reason: 'low_confidence' }]])
  };
  const adapter = {
    async classify() {
      return {
        ok: true,
        results: [
          {
            ok: true,
            label: 'fear_urgency',
            confidence: 0.8,
            model: 'jev-1.13.0',
            modelMatch: true
          }
        ],
        meta: { classifications: 1, model: 'jev-1.13.0', tier: 'smart' },
        networkCalls: 1
      };
    }
  };
  const first = await runSelectiveCascade({
    spans: [span],
    jevResult,
    adapter,
    taxonomyVersion: 'cdev-taxonomy-1.0.0',
    minConfidence: 0.7
  });
  const second = await runSelectiveCascade({
    spans: [span],
    jevResult,
    adapter,
    taxonomyVersion: 'cdev-taxonomy-1.0.0',
    minConfidence: 0.7
  });
  assert.equal(canonicalDecision(first.bySpanId.get('span-1')), canonicalDecision(second.bySpanId.get('span-1')));
  assert.equal(first.bySpanId.get('span-1').disposition, 'agree_calibrated');
  assert.equal(first.policyVersion, CASCADE_POLICY_VERSION);
  assert.equal(minimumSpanText({ text: '  hello  ' }), 'hello');
});

test('applyCascadeDispositions never replaces a Jev signal with a silent classifier.dev winner', () => {
  const fusionResult = {
    observations: [
      {
        id: 'obs-jev-1',
        span_ids: ['span-1'],
        signal: 'none',
        review_status: 'auto',
        evidence: { engine: 'jev', question_id: 'influence_signal', top_probability: 0.9, answers_ref: 'span-1' }
      }
    ],
    abstentions: []
  };
  applyCascadeDispositions(fusionResult, {
    bySpanId: new Map([
      [
        'span-1',
        {
          escalated: true,
          disposition: 'disagree_review',
          jevChoice: 'none',
          cdevLabel: 'personal_attack'
        }
      ]
    ])
  });
  assert.equal(fusionResult.observations[0].signal, 'none');
  assert.equal(fusionResult.observations[0].review_status, 'needs_review');
  assert.equal(fusionResult.abstentions[0].reason, 'low_confidence');
  assert.match(fusionResult.abstentions[0].message, /flagged for human review/);
});

test('analyze() with classifier.dev disabled keeps golden fixture graphs free of classifier_dev', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(graph.engine.classifier_dev, undefined);
});

test('selective cascade behind ENABLE_CLASSIFIER_DEV records evaluation metadata and does not enable live URL', async () => {
  let hits = 0;
  const adapter = createClassifierDevAdapter({
    enabled: true,
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => {
      hits += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'v1' },
        async json() {
          return {
            tier: 'smart',
            model: 'jev-1.13.0',
            results: [{ label: 'no_detected_signal', confidence: 0.9, scores: { no_detected_signal: 0.9 } }]
          };
        }
      };
    }
  });
  const config = loadConfig({ MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true' });
  assert.equal(config.liveUrlEnabled, false);
  const graph = await runFixture('synthetic-01-quoted-vs-authorial', { config, classifierDevAdapter: adapter });
  const { valid, errors } = validate(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(graph.engine.classifier_dev.evaluation_only, true);
  assert.equal(graph.engine.classifier_dev.mode, 'evaluation');
  assert.ok(graph.privacy.external_processing.some((row) => row.recipient.includes('classifier.dev')));
  assert.equal(hits, graph.engine.classifier_dev.calls);
  assert.ok(hits >= 1, 'selective cascade must call the adapter for this fixture');
  assert.ok(graph.engine.classifier_dev.escalated_span_count >= 1);
  assert.equal(graph.engine.classifier_dev.policy_version, CASCADE_POLICY_VERSION);
});
