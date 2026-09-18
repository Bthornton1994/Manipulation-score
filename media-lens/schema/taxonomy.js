// Media Lens influence taxonomy for influence-graph.v1.
//
// This module is the single source of truth for taxonomy ids, their labels
// and plain-language explanations, and the exact UI phrases the renderer is
// allowed to use for observation headers. Nothing here computes a score,
// rank, or person/outlet label. See docs/media-lens-build-brief.md
// ("Influence taxonomy") and docs/media-lens-influence-graph-plan.md
// (section 4) for the source decisions.

export const TAXONOMY = Object.freeze({
  loaded_moralized: {
    label: 'Loaded or moralized language',
    explanation: 'Word choices that carry a moral judgment instead of a neutral description of the same fact.'
  },
  fear_threat: {
    label: 'Fear or threat framing',
    explanation: 'Language that emphasizes danger or harm to create alarm about the subject.'
  },
  urgency: {
    label: 'Urgency framing',
    explanation: 'Language that compresses the time a reader has to think, verify, or act.'
  },
  false_dilemma: {
    label: 'False dilemma',
    explanation: 'Presents only two options when more may exist.'
  },
  identity_ingroup: {
    label: 'Identity or in-group framing',
    explanation: 'Appeals to group membership or loyalty rather than the substance of a claim.'
  },
  scapegoating_dehumanizing: {
    label: 'Scapegoating or dehumanizing language',
    explanation: 'Assigns blame to a person or group in terms that strip away their individuality.'
  },
  certainty_beyond_evidence: {
    label: 'Certainty beyond evidence',
    explanation: 'States a conclusion with more confidence than the cited support would justify.'
  },
  vague_authority: {
    label: 'Vague authority',
    explanation: 'Cites an unnamed or unspecific authority ("experts say", "officials confirm") without a checkable source.'
  },
  anecdote_generalization: {
    label: 'Anecdote generalized',
    explanation: 'Extends a single story or example into a broader claim about a group or trend.'
  },
  selective_context_candidate: {
    label: 'Possible selective-context candidate',
    explanation: 'A detail present in one account of a story is missing from another, which may or may not change the meaning.'
  },
  bandwagon: {
    label: 'Bandwagon appeal',
    explanation: 'Suggests a position is correct mainly because many people hold it.'
  },
  adversarial_conflict_framing: {
    label: 'Adversarial or conflict framing',
    explanation: 'Casts a situation primarily as a fight between opposing sides rather than describing what happened.'
  }
});

export const TAXONOMY_IDS = Object.freeze(Object.keys(TAXONOMY));

// The only strength value fusion may assign to selective_context_candidate.
// Enforced in worker/fusion.js and re-checked in schema/validate.js.
export const SELECTIVE_CONTEXT_ONLY_CANDIDATE_ID = 'selective_context_candidate';

// Exact strings the renderer may use for observation headers. No other
// phrase may appear as an observation header. tests/media-lens-ui.test.js
// and tests/media-lens-schema.test.js both check against this list.
export const ALLOWED_UI_PHRASES = Object.freeze([
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
]);

// Strings that must never appear in any user-facing message, ui_phrase, or
// disclosure text produced by this system. Checked recursively by
// schema/validate.js (invariant 7) and directly by tests/media-lens-ui.test.js.
export const BANNED_PHRASES = Object.freeze([
  'manipulative',
  'proves',
  'misinformation',
  'unsafe',
  'propaganda'
]);
