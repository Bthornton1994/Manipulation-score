import { detectSafetyNotice } from './safety.js';
import {
  normalizeAnalysisText,
  isLikelyUnsupportedLanguage
} from './text-normalize.js';

export const SCORE_BANDS = [
  {
    id: 'low',
    label: 'Low',
    min: 0,
    max: 30,
    headline: 'Low pressure patterns',
    summary: 'Few or mild language patterns. The message may still feel difficult—context matters more than the rating.'
  },
  {
    id: 'moderate',
    label: 'Moderate',
    min: 31,
    max: 60,
    headline: 'Moderate pressure patterns',
    summary: 'Clear language functions are present that may narrow your space to think, question, or respond at your own pace.'
  },
  {
    id: 'high',
    label: 'High',
    min: 61,
    max: 100,
    headline: 'High pressure patterns',
    summary: 'Multiple clear pressure functions appear together—language that can significantly compress your room to pause, refuse, or seek support.'
  }
];

const SIGNALS = [
  {
    id: 'guilt',
    label: 'Guilt leverage',
    function: 'Uses care, loyalty, or past effort as currency—making a boundary or delay feel like proof you do not care enough.',
    weight: 20,
    pattern: /if you (?:really )?(?:cared|loved|loved me)|after all i(?:'ve| have) done|you owe me|\bungrateful\b|\bselfish\b|how could you/gi,
    education: 'Guilt framing ties affection or loyalty to a specific action. A normal boundary can be reframed as betrayal.'
  },
  {
    id: 'urgency',
    label: 'Forced urgency',
    function: 'Compresses your decision window so agreement happens before you can think, check facts, or consult others.',
    weight: 22,
    pattern: /right now|immediately|last chance|before it(?:'s| is) too late|need an answer(?:\s+now|\s+immediately)?|no time to wait|answer (?:right )?now/gi,
    education: 'Forced urgency shrinks reflection time. It can push you to agree before you have processed what you need.'
  },
  {
    id: 'threat',
    label: 'Conditional threat',
    function: 'Links cooperation to a stated or implied penalty—making honesty or refusal feel risky.',
    weight: 26,
    pattern: /or else|you(?:'ll| will) regret|if you don(?:'t|’t| not)|i(?:'ll| will) leave|never (?:speak|talk) to you|you(?:'ll| will) be sorry/gi,
    education: 'Conditional threats connect compliance to punishment or withdrawal. Safety and honesty can feel costly.'
  },
  {
    id: 'isolation',
    label: 'Isolation pressure',
    function: 'Discourages outside perspective—positioning support networks as threats to the relationship or secrecy as required.',
    weight: 22,
    pattern: /(?:do\s+not|don(?:'t|’t))\s+tell (?:them|anyone)|they(?:'re| are) against you|only one who understands|your friends don(?:'t|’t) care|just between us/gi,
    education: 'Isolation language discourages checking with others. Outside perspective is often healthy—not a threat.'
  },
  {
    id: 'dismissal',
    label: 'Reality dismissal',
    function: 'Challenges your memory, perception, or emotional response instead of engaging with what you experienced.',
    weight: 18,
    pattern: /you(?:'re| are) imagining|that never happened|too sensitive|you(?:'re| are) crazy|making things up|overreacting/gi,
    education: 'Reality dismissal targets your perception rather than the content of your concern. Your experience deserves space.'
  },
  {
    id: 'absolutes',
    label: 'All-or-nothing framing',
    function: 'Turns a single moment into a permanent character verdict—making nuance or partial agreement feel impossible.',
    weight: 10,
    pattern: /\b(?:always|never|everyone|nobody|everything|nothing)\b/gi,
    education: 'Words like “always” and “never” flatten specifics into permanent patterns. One event rarely proves a rule.'
  },
  {
    id: 'obligation',
    label: 'Assigned obligation',
    function: 'Reframes a request as duty or requirement—so compliance feels mandatory rather than chosen.',
    weight: 14,
    pattern: /you (?:should|must|have to|need to)|after everything|it(?:'s| is) your (?:job|duty|responsibility)/gi,
    education: 'Obligation pressure assigns responsibility to you. You can care about someone without accepting assigned duties.'
  },
  {
    id: 'minimization',
    label: 'Reaction minimization',
    function: 'Shrinks or ridicules your response to close the topic—implying the problem is your reaction, not the issue.',
    weight: 12,
    pattern: /you(?:'re| are) being dramatic|not that bad|calm down|stop being so|you(?:'re| are) too much/gi,
    education: 'Minimization shrinks your reaction to end the conversation. Response size does not prove you are wrong.'
  },
  {
    id: 'resigned_withdrawal',
    label: 'Resigned withdrawal',
    function: 'Signals pulling back or giving up while leaving the rupture unresolved—often inviting you to chase or repair.',
    weight: 18,
    pattern: /fine,?\s*forget it|i'm done(?: trying)?|whatever\.?$|i guess so|forget about it/gi,
    education: 'Resigned withdrawal ends engagement abruptly. The unfinished tension can pressure you to re-open the conversation.'
  },
  {
    id: 'implied_rejection',
    label: 'Implied rejection',
    function: 'Draws a negative conclusion about your value or place in the relationship without stating it directly—inviting you to disprove it.',
    weight: 22,
    pattern: /i guess i know where i stand|know where i stand|how little i matter|obviously don'?t care|not important (?:to you|enough)|clear where i stand/gi,
    education: 'Implied rejection states a hurtful conclusion indirectly. You may feel pushed to prove you do care or value them.'
  },
  {
    id: 'conditional_access',
    label: 'Conditional access',
    function: 'Offers or withholds connection based on your behavior—making attention feel like a reward you must earn or chase.',
    weight: 20,
    pattern:
      /don'?t bother (?:reaching out|contacting|calling|texting|messaging)|if you can'?t make time|unless you\s+(?:do|apologize|prove|agree|stop|care|love|commit|what i asked)|don'?t expect me to reach out|when you have time for me|(?:won'?t|will not)\s+(?:speak|talk|see|call|contact)\s+(?:to\s+)?you\s+unless|(?:do not|don't)\s+get\s+to\s+see\s+me\s+unless/gi,
    education: 'Conditional access ties warmth or contact to compliance. Your limits can be reframed as withholding care.'
  },
  {
    id: 'responsibility_shift',
    label: 'Responsibility shifting',
    function: 'Frames your limits (time, energy, boundaries) as the cause of the speaker’s hurt—moving accountability onto you.',
    weight: 19,
    pattern: /if you can'?t make time|if you don'?t have time|you don'?t (?:care|prioritize)|too busy for me|can'?t be bothered|make time for me/gi,
    education: 'Responsibility shifting converts your boundaries into evidence of neglect. Their feelings are valid—but not always your assignment to fix.'
  }
];

export const METHODOLOGY_VERSION = '0.3.2';
export const PILOT_SUPPRESS_NUMERIC_SCORE = true;
export { normalizeAnalysisText } from './text-normalize.js';
export const MIN_MEANINGFUL_WORDS = 15;

const EXCLUSION_CONTEXT_RULES = {
  isolation: [
    /surprise\s+party/i,
    /do\s+not\s+tell\s+anyone\s+your\s+password/i,
    /account\s+was\s+compromised/i,
    /contact\s+support\s+immediately/i
  ],
  urgency: [
    /no\s+pressure/i,
    /nothing\s+needs\s+to\s+be\s+decided/i,
    /not\s+decided\s+right\s+now/i,
    /no\s+rush/i,
    /no\s+urgency/i,
    /understand\s+that\s+you\s+need\s+time/i,
    /no\s+pressure\s+to\s+answer/i,
    /completely\s+okay\s+to\s+say\s+no/i,
    /okay\s+to\s+say\s+no/i,
    /so\s+i\s+can\s+make\s+plans/i,
    /evacuate\s+immediately/i,
    /smoke\s+is\s+entering/i
  ],
  absolutes: [
    /have\s+choices/i,
    /(?:everyone|nobody)\s+is\s+(?:invited|welcome)/i,
    /nobody\s+is\s+required/i,
    /not\s+required\s+to\s+participate/i,
    /no\s+pressure/i,
    /nothing\s+needs\s+to\s+be\s+decided/i,
    /never\s+(?:hurt|harm|kill)\s+you/i,
    /want\s+you\s+to\s+feel\s+safe/i,
    /(?:training|instructor|trainer|teacher|facilitator|example|demonstrat).{0,120}nobody\s+is\s+required/i,
    /during\s+(?:safety\s+)?training.{0,140}nobody/i,
    /everyone\s+must\s+wear/i,
    /security\s+policy/i,
    /per\s+the\s+(?:security|company)\s+policy/i,
    /you\s+can\s+always\s+end\s+the\s+call/i,
    /crisis\s+line.{0,100}always/i
  ],
  obligation: [
    /legal\s+deadline/i,
    /by\s+(?:the\s+)?law/i,
    /tax\s+form/i,
    /registration\s+closes/i,
    /if\s+that\s+timeline\s+does\s+not\s+work/i,
    /if\s+you\s+are\s+not\s+ready/i,
    /whatever\s+time\s+you\s+need\s+to/i,
    /all\s+the\s+time\s+you\s+need/i,
    /time\s+you\s+need\s+to\s+think/i,
    /take\s+(?:whatever\s+)?time\s+you\s+need/i,
    /take\s+your\s+time/i,
    /when\s+you\s+are\s+(?:ready|comfortable)/i,
    /when\s+you'?re\s+(?:ready|comfortable)/i,
    /at\s+your\s+own\s+pace/i,
    /no\s+rush/i,
    /no\s+pressure/i,
    /feel\s+free\s+to\s+take/i,
    /you\s+should\s+talk\s+to\s+your\s+(?:doctor|therapist|counselor|pharmacist)/i,
    /pharmacist\s+explained/i,
    /clinic\s+said/i,
    /compliance\s+training/i,
    /company\s+policy/i,
    /required\s+by\s+(?:company|law|policy)/i,
    /as\s+required\s+by/i,
    /you\s+must\s+take\s+this\s+antibiotic/i,
    /wear\s+a\s+badge/i,
    /review\s+the\s+handbook/i,
    /you\s+need\s+to\s+think\s+about\s+what\s+you\s+want/i,
    /you\s+need\s+to\s+drink\s+water/i,
    /in\s+the\s+script.{0,80}\byou\s+must\b/i,
    /coach\s+says\s+you\s+must\s+practice/i,
    /de-?escalation\s+training.{0,100}you\s+should/i,
    /(?:safety|crisis\s+line)\s+training.{0,100}you\s+(?:should|can)/i,
    /if\s+you\s+need\s+to\s+step\s+away/i,
    /crisis\s+line.{0,120}you\s+need\s+to/i,
    /wear\s+your\s+seatbelt/i,
    /talk\s+to\s+a\s+lawyer/i,
    /understand\s+your\s+legal\s+rights/i,
    /you\s+need\s+to\s+evacuate/i
  ],
  conditional_access: [
    /unless\s+you\s+(?:invite|ask|give|want)/i,
    /will\s+not\s+(?:visit|call|share|come)/i,
    /respect\s+your\s+(?:decision|privacy|boundaries|space)/i,
    /give\s+me\s+permission/i,
    /change\s+your\s+mind/i,
    /met\s+there/i,
    /unless\s+you\s+give\s+me\s+permission/i
  ]
};

const SIGNAL_FAMILIES = {
  withdrawal: ['resigned_withdrawal', 'implied_rejection', 'conditional_access', 'responsibility_shift'],
  pressure: ['guilt', 'urgency', 'threat', 'obligation'],
  distortion: ['dismissal', 'minimization', 'absolutes', 'isolation']
};

const CLEAR_PRESSURE_IDS = new Set([
  ...SIGNAL_FAMILIES.pressure,
  ...SIGNAL_FAMILIES.withdrawal,
  'isolation',
  'dismissal'
]);

const SOFT_SIGNAL_IDS = new Set(['absolutes', 'minimization']);

/** high = narrow coercive patterns; medium = contextual pressure; low = broad lexical hooks */
const SIGNAL_SPECIFICITY = {
  guilt: 'high',
  threat: 'high',
  conditional_access: 'high',
  implied_rejection: 'high',
  resigned_withdrawal: 'high',
  responsibility_shift: 'high',
  urgency: 'medium',
  isolation: 'medium',
  dismissal: 'medium',
  minimization: 'low',
  absolutes: 'low',
  obligation: 'low'
};

function getSignalSpecificity(signalId) {
  return SIGNAL_SPECIFICITY[signalId] || 'medium';
}

const LEVERAGE_CLUSTERS = [
  {
    id: 'withdrawal_leverage',
    label: 'Emotional leverage via withdrawal',
    function:
      'The message withdraws warmth, access, or effort while implying you caused it—pressuring you to chase, apologize, or rearrange priorities to restore connection.',
    indicators: ['resigned_withdrawal', 'implied_rejection', 'conditional_access', 'responsibility_shift', 'guilt'],
    minIndicators: 2
  },
  {
    id: 'pressure_stack',
    label: 'Stacked pressure tactics',
    function:
      'Several distinct pressure functions appear together—narrowing room to pause, question, seek support, or respond at your own pace.',
    minDistinctSignals: 3
  },
  {
    id: 'urgency_consequence',
    label: 'Deadline with consequence',
    function:
      'Urgency is paired with a threat or withdrawal—raising the cost of taking time to think before you answer.',
    required: ['urgency', 'threat'],
    scoreBonus: 10
  },
  {
    id: 'guilt_obligation',
    label: 'Guilt plus assigned duty',
    function:
      'Care or loyalty is weaponized alongside assigned responsibility—so refusing feels like both uncaring and disobedient.',
    required: ['guilt', 'obligation'],
    scoreBonus: 8
  }
];

const RESPONSES = {
  pause: {
    guilt: 'I care about this relationship. I still need time before I answer.',
    urgency: 'I can’t give you an answer right now. I’ll respond when I’ve had time to think.',
    threat: 'I’m not comfortable continuing under pressure. I need a pause.',
    isolation: 'I may talk with people I trust about this. I need space to think first.',
    dismissal: 'My feelings are valid. I’d like us to slow down and talk when we’re calmer.',
    absolutes: 'I don’t think it’s always or never. Let’s talk about what happened specifically.',
    obligation: 'I hear what you want. I need time before I commit to anything.',
    minimization: 'How I feel matters to me. I’d like to finish this conversation later.',
    resigned_withdrawal: 'I hear that you’re pulling back. I still need time before I respond.',
    implied_rejection: 'I hear that you feel hurt. I’d like to understand what you need without rushing.',
    conditional_access: 'I’m not available to talk right now, but that isn’t proof I don’t care.',
    responsibility_shift: 'I hear you’re upset. My limits on time aren’t the same as not caring.',
    default: 'I need time to think. I’ll respond when I’m ready.'
  },
  boundary: {
    guilt: 'My care for you isn’t measured by how fast I reply.',
    urgency: 'I won’t be rushed into a decision.',
    threat: 'I won’t continue a conversation that includes threats.',
    isolation: 'I’m allowed to seek outside perspective.',
    dismissal: 'I won’t accept being told my experience isn’t real.',
    absolutes: 'I won’t accept being defined in absolute terms.',
    obligation: 'I get to choose what I’m responsible for.',
    minimization: 'I won’t minimize how this affects me.',
    resigned_withdrawal: 'I won’t chase a conversation that was ended to pressure me.',
    implied_rejection: 'I won’t accept being told where I “stand” without a direct conversation.',
    conditional_access: 'Connection shouldn’t be offered only when I comply.',
    responsibility_shift: 'I’m not responsible for fixing this by abandoning my limits.',
    default: 'I’m willing to talk, but not under pressure.'
  },
  clarify: {
    guilt: 'Can you tell me more about what you need, without comparing it to how much I care?',
    urgency: 'What’s driving the timeline? I want to understand before I respond.',
    threat: 'What outcome are you hoping for if I don’t agree?',
    isolation: 'Why does this need to stay between us?',
    dismissal: 'Can we talk about what I experienced, even if we see it differently?',
    absolutes: 'Can we focus on this specific situation instead of always/never?',
    obligation: 'What do you see as my responsibility here?',
    minimization: 'Can you help me understand why my reaction feels unreasonable to you?',
    resigned_withdrawal: 'Are you ending this conversation, or asking for something from me?',
    implied_rejection: 'What conclusion are you drawing about me or this relationship?',
    conditional_access: 'Are you saying contact depends on how I behave?',
    responsibility_shift: 'Are my limits being taken as proof I don’t care?',
    default: 'I want to make sure I understand. Can you tell me more about what you need?'
  },
  none: 'I want to make sure I understand. Can you tell me more about what you need?'
};

const SEVERITY_RANK = { mild: 0, moderate: 1, strong: 2 };

export function countMeaningfulWords(text) {
  return (text.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
}

function getMatchContext(text, start, end, padding = 56) {
  const ctxStart = Math.max(0, start - padding);
  const ctxEnd = Math.min(text.length, end + padding);
  return text.slice(ctxStart, ctxEnd);
}

function isOffsetExcluded(signalId, text, offset) {
  const context = getMatchContext(text, offset.start, offset.end);

  const guiltWindow = text.slice(Math.max(0, offset.start - 45), offset.end);
  if (
    signalId === 'guilt' &&
    /\b(?:ungrateful|selfish)\b/i.test(offset.text) &&
    /\b(?:not|never)\s+(?:calling|saying)\s+you\b/i.test(guiltWindow)
  ) {
    return true;
  }

  const rules = EXCLUSION_CONTEXT_RULES[signalId];
  if (rules?.some((rule) => rule.test(context))) return true;

  if (signalId === 'urgency' && /(?:^|\s)no\s+[^.!?]{0,30}right\s+now/i.test(context)) return true;
  if (signalId === 'absolutes' && /(?:care|understand|choices|invited|welcome|required\s+to\s+participate|feel\s+safe)/i.test(context)) {
    if (/always\s+have\s+choices|everyone\s+is\s+invited|nobody\s+is\s+required|never\s+(?:hurt|harm|kill)\s+you/i.test(context)) return true;
  }

  if (signalId === 'absolutes' && /\bnobody\b/i.test(context)) {
    if (/nobody\s+else\s+will\s+(?:care|understand|help)/i.test(context)) return false;
    if (/(?:training|instructor|trainer|teacher|facilitat|example|demonstrat).{0,140}nobody/i.test(context)) return true;
  }

  if (signalId === 'obligation' && /\byou\s+need\s+to\b/i.test(context)) {
    if (
      /whatever\s+time\s+you\s+need\s+to|all\s+the\s+time\s+you\s+need|time\s+you\s+need\s+to\s+think|take\s+(?:whatever\s+)?time/i.test(
        context
      )
    ) {
      return true;
    }
    if (
      /when\s+you\s+are\s+(?:ready|comfortable)|when\s+you'?re\s+(?:ready|comfortable)/i.test(context) &&
      /take\s+your\s+time|no\s+rush|no\s+pressure|comfortable\s+talking/i.test(context)
    ) {
      return true;
    }
    if (/\byou\s+should\b/i.test(context) && /talk\s+to\s+your\s+(?:doctor|therapist|counselor|pharmacist)/i.test(context)) {
      return true;
    }
  }

  return false;
}

function createAbstentionResult(reasons) {
  return {
    abstained: true,
    abstentionReasons: reasons,
    scoreSuppressed: true,
    score: null,
    level: null,
    band: null,
    bandHeadline: 'Not enough text to assess',
    bandSummary: reasons.join(' '),
    signals: [],
    signalCount: 0,
    responses: buildResponses([]),
    response: RESPONSES.none,
    highlights: [],
    segments: null,
    leverageInsights: [],
    clusterBonus: 0,
    methodologyVersion: METHODOLOGY_VERSION,
    experimentalScreening: true
  };
}

function createSafetyResult(safetyNotice, normalized) {
  return {
    abstained: false,
    scoreSuppressed: true,
    safetyNotice,
    abstentionReasons: [],
    score: null,
    level: null,
    band: null,
    bandHeadline: safetyNotice.headline,
    bandSummary: safetyNotice.summary,
    signals: [],
    signalCount: 0,
    responses: buildResponses([]),
    response: RESPONSES.none,
    highlights: [],
    segments: null,
    leverageInsights: [],
    clusterBonus: 0,
    methodologyVersion: METHODOLOGY_VERSION,
    experimentalScreening: true,
    sourceText: normalized
  };
}

function findOffsets(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const offsets = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    offsets.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return offsets;
}

export function getScoreBand(score) {
  if (score <= 30) return SCORE_BANDS[0];
  if (score <= 60) return SCORE_BANDS[1];
  return SCORE_BANDS[2];
}

export function getSignalSeverity(signal) {
  const extra = signal.points - signal.weight;
  if (extra >= 6 || signal.points >= 28) return { label: 'Strong', level: 'strong' };
  if (extra >= 3 || signal.points >= 20) return { label: 'Clear', level: 'moderate' };
  return { label: 'Mild', level: 'mild' };
}

export function getSignalResponses(signalId) {
  return {
    pause: RESPONSES.pause[signalId] || RESPONSES.pause.default,
    boundary: RESPONSES.boundary[signalId] || RESPONSES.boundary.default
  };
}

function pickResponse(style, signals) {
  if (!signals.length) return RESPONSES.none;
  const primary = [...signals].sort((a, b) => b.points - a.points)[0];
  return RESPONSES[style][primary.id] || RESPONSES[style].default;
}

export function buildResponses(signals) {
  return {
    pause: pickResponse('pause', signals),
    boundary: pickResponse('boundary', signals),
    clarify: pickResponse('clarify', signals)
  };
}

export function getHighlightRanges(signals) {
  const ranges = [];
  for (const signal of signals) {
    for (const offset of signal.offsets) {
      ranges.push({ ...offset, id: signal.id, label: signal.label });
    }
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function splitMessages(text) {
  const parts = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text.trim()];
}

export function excerptForOffsets(text, offsets, padding = 36) {
  if (!offsets.length) return { excerpt: text, ranges: [] };
  const start = Math.max(0, offsets[0].start - padding);
  const end = Math.min(text.length, offsets[offsets.length - 1].end + padding);
  const slice = text.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const prefixLen = prefix.length;
  const ranges = offsets.map((offset) => ({
    start: offset.start - start + prefixLen,
    end: offset.end - start + prefixLen,
    text: offset.text,
    id: offset.id,
    label: offset.label
  }));
  return {
    excerpt: prefix + slice,
    ranges,
    truncatedEnd: end < text.length
  };
}

function detectLeverageClusters(signalIds) {
  const ids = new Set(signalIds);
  const clusters = [];

  for (const cluster of LEVERAGE_CLUSTERS) {
    if (cluster.required) {
      if (cluster.required.every((id) => ids.has(id))) clusters.push(cluster);
      continue;
    }
    if (cluster.minDistinctSignals && ids.size >= cluster.minDistinctSignals) {
      clusters.push(cluster);
      continue;
    }
    if (cluster.indicators) {
      const matched = cluster.indicators.filter((id) => ids.has(id));
      if (matched.length >= cluster.minIndicators) {
        clusters.push({ ...cluster, matchedIndicators: matched });
      }
    }
  }

  return clusters;
}

function scoreSignalFamily(signalsInFamily) {
  if (!signalsInFamily.length) return 0;
  const sorted = [...signalsInFamily].sort((a, b) => b.points - a.points);
  let total = sorted[0].points;
  for (let i = 1; i < sorted.length; i += 1) {
    total += sorted[i].points * 0.42;
  }
  return Math.min(total, 52);
}

function computeAggregateScore(signals) {
  const familyBuckets = Object.fromEntries(Object.keys(SIGNAL_FAMILIES).map((key) => [key, []]));
  const standalone = [];

  for (const signal of signals) {
    const family = Object.entries(SIGNAL_FAMILIES).find(([, ids]) => ids.includes(signal.id))?.[0];
    if (family) familyBuckets[family].push(signal);
    else standalone.push(signal);
  }

  let total = standalone.reduce((sum, signal) => sum + signal.points, 0);
  for (const familySignals of Object.values(familyBuckets)) {
    total += scoreSignalFamily(familySignals);
  }
  return total;
}

function isClearPressure(signalId) {
  return CLEAR_PRESSURE_IDS.has(signalId);
}

function isPressureSignal(signalId) {
  return SIGNAL_FAMILIES.pressure.includes(signalId) || SIGNAL_FAMILIES.withdrawal.includes(signalId);
}

function calibrateScore(rawScore, signals, clusters) {
  if (!signals.length) return 0;

  const clearSignals = signals.filter((s) => isClearPressure(s.id));
  const clearCount = clearSignals.length;
  const highTierCount = clearSignals.filter((s) => getSignalSpecificity(s.id) === 'high').length;
  const softOnly = signals.every((s) => SOFT_SIGNAL_IDS.has(s.id));
  const pressureCount = signals.filter((s) => SIGNAL_FAMILIES.pressure.includes(s.id)).length;
  let score = rawScore;

  if (clearCount === 1 && highTierCount === 0) {
    const primary = clearSignals[0];
    const tier = getSignalSpecificity(primary.id);
    const strongMedium =
      tier === 'medium' &&
      primary.offsets.length >= 2 &&
      primary.severity.level !== 'mild';
    if (strongMedium) {
      score = Math.max(score, 46);
      if (primary.offsets.length >= 3 || primary.severity.level === 'strong') {
        score = Math.max(score, 50);
      }
    } else {
      score = Math.min(score, 30);
    }
  }

  if (clearCount === 1 && highTierCount === 1) {
    const primary = clearSignals[0];
    score = Math.max(score, 46);
    if (primary.offsets.length >= 2 || primary.severity.level === 'strong') score = Math.max(score, 50);
    if (primary.offsets.length >= 3) score = Math.max(score, 54);
  }

  if (clearCount >= 2) score = Math.max(score, 54);
  if (clearCount >= 3) score = Math.max(score, 58);
  if (clearCount >= 4) score = Math.max(score, 60);

  if (pressureCount >= 3) score = Math.max(score, 65);
  if (clearCount >= 3 && pressureCount >= 2) score = Math.max(score, 66);
  if (clusters.length >= 2 && clearCount >= 2) score = Math.max(score, 64);

  if (softOnly && clearCount === 0) {
    score = Math.min(score, signals.length >= 3 ? 30 : 22);
  }

  if (score >= 61) {
    const qualifiesHigh =
      clearCount >= 3 ||
      (clearCount >= 2 && pressureCount >= 2) ||
      (clusters.length >= 1 && clearCount >= 2 && highTierCount >= 1);
    if (!qualifiesHigh) score = Math.min(score, 60);
  }

  return Math.min(100, Math.round(score));
}

function scoreOffsets(weight, offsets, signalId) {
  const tier = getSignalSpecificity(signalId);
  const matchBonus = Math.min(12, Math.max(0, offsets.length - 1) * 5);
  let points = weight + matchBonus;

  if (tier === 'high' && isClearPressure(signalId)) {
    if (offsets.length >= 1) points = Math.max(points, 40);
    if (offsets.length >= 2) points = Math.max(points, 46);
    if (offsets.length >= 3) points = Math.max(points, 52);
  } else if (tier === 'medium' && offsets.length >= 2) {
    points = Math.max(points, 32);
    if (offsets.length >= 3) points = Math.max(points, 36);
  }

  const cap = tier === 'high' ? 55 : tier === 'medium' ? 38 : 24;
  return Math.min(points, cap);
}

function analyzeSingleMessage(normalized) {
  const rawSignals = SIGNALS.flatMap((signal) => {
    const offsets = findOffsets(normalized, signal.pattern).filter(
      (offset) => !isOffsetExcluded(signal.id, normalized, offset)
    );
    if (!offsets.length) return [];

    const matches = [...new Set(offsets.map((o) => o.text.toLowerCase()))];
    const points = scoreOffsets(signal.weight, offsets, signal.id);
    const severity = getSignalSeverity({ ...signal, points });
    const responses = getSignalResponses(signal.id);

    return [{
      ...signal,
      detail: signal.function,
      matches,
      offsets,
      points,
      severity,
      responses,
      excerpt: excerptForOffsets(
        normalized,
        offsets.map((o) => ({ ...o, id: signal.id, label: signal.label }))
      )
    }];
  });

  const clusters = detectLeverageClusters(rawSignals.map((s) => s.id));
  const clusterBonus = clusters.reduce((sum, cluster) => sum + (cluster.scoreBonus || 0), 0);

  let score = rawSignals.length ? Math.min(100, computeAggregateScore(rawSignals) + clusterBonus) : 0;

  const signals = [...rawSignals].sort((a, b) => b.points - a.points);

  signals.forEach((signal) => {
    signal.severity = getSignalSeverity(signal);
  });

  score = calibrateScore(score, signals, clusters);

  const band = getScoreBand(score);
  const responses = buildResponses(signals);
  const highlights = getHighlightRanges(signals);

  const leverageInsights = clusters.map((cluster) => ({
    id: cluster.id,
    label: cluster.label,
    function: cluster.function,
    matchedIndicators: cluster.matchedIndicators || cluster.required || []
  }));

  return {
    score,
    level: band.label,
    band,
    bandHeadline: band.headline,
    bandSummary: band.summary,
    signals,
    signalCount: signals.length,
    responses,
    response: responses.pause,
    highlights,
    leverageInsights,
    clusterBonus
  };
}

function buildEmptyResult() {
  return createAbstentionResult([
    'No message to analyze.',
    'Paste or type the message you want to screen.'
  ]);
}

function buildThreadResult(normalized, segmentAnalyses) {
  const safetySegment = segmentAnalyses.find((entry) => entry.analysis.safetyNotice);
  if (safetySegment) {
    return {
      ...safetySegment.analysis,
      segments: segmentAnalyses
    };
  }

  const scoredSegments = segmentAnalyses.filter(
    (entry) => !entry.analysis.abstained && !entry.analysis.scoreSuppressed
  );

  if (!scoredSegments.length) {
    return {
      ...createAbstentionResult([
        'Not enough text in the individual messages for thread screening.',
        `Each message in this thread has fewer than ${MIN_MEANINGFUL_WORDS} recognizable words needed for screening.`,
        'Paste more text per message, or analyze messages individually.'
      ]),
      segments: segmentAnalyses
    };
  }

  const primary = scoredSegments.reduce((best, entry) =>
    entry.analysis.score > best.analysis.score ? entry : best
  );

  return {
    ...primary.analysis,
    abstained: false,
    scoreSuppressed: false,
    safetyNotice: null,
    abstentionReasons: [],
    methodologyVersion: METHODOLOGY_VERSION,
    experimentalScreening: true,
    segments: segmentAnalyses,
    threadSummary: 'Overall reflects the highest-scoring eligible message in this thread.'
  };
}

export function analyzeMessage(text) {
  const normalized = normalizeAnalysisText(text);
  if (!normalized) {
    return { ...buildEmptyResult(), level: 'No message' };
  }

  if (isLikelyUnsupportedLanguage(normalized)) {
    return createAbstentionResult([
      'English-only screening in this Controlled Beta.',
      'This message appears to use a language or script Clarity does not screen yet.',
      'Clarity currently screens English text only. Paste an English translation or summary to screen patterns.'
    ]);
  }

  const segments = splitMessages(normalized);
  if (segments.length > 1) {
    const segmentAnalyses = segments.map((segment, index) => ({
      index: index + 1,
      text: segment,
      analysis: analyzeSegment(segment)
    }));
    return buildThreadResult(normalized, segmentAnalyses);
  }

  const safetyNotice = detectSafetyNotice(normalized);
  if (safetyNotice) {
    return createSafetyResult(safetyNotice, normalized);
  }

  const meaningfulWords = countMeaningfulWords(normalized);
  if (meaningfulWords < MIN_MEANINGFUL_WORDS) {
    return createAbstentionResult([
      'Not enough text for pattern screening in this Controlled Beta.',
      `This message has about ${meaningfulWords} recognizable words. Screening requires at least ${MIN_MEANINGFUL_WORDS} recognizable words.`,
      'Paste more of the message, or additional messages from the same conversation, to receive a screening result.'
    ]);
  }

  const analysis = analyzeSingleMessage(normalized);
  return {
    ...analysis,
    abstained: false,
    scoreSuppressed: false,
    safetyNotice: null,
    abstentionReasons: [],
    methodologyVersion: METHODOLOGY_VERSION,
    experimentalScreening: true,
    segments: null
  };
}

function analyzeSegment(segment) {
  const trimmed = segment.trim();
  if (!trimmed) return buildEmptyResult();

  const safetyNotice = detectSafetyNotice(trimmed);
  if (safetyNotice) return createSafetyResult(safetyNotice, trimmed);

  const meaningfulWords = countMeaningfulWords(trimmed);
  if (meaningfulWords < MIN_MEANINGFUL_WORDS) {
    return createAbstentionResult([
      'Not enough text in this message for screening.',
      `About ${meaningfulWords} recognizable words; need at least ${MIN_MEANINGFUL_WORDS}.`
    ]);
  }

  return {
    ...analyzeSingleMessage(trimmed),
    abstained: false,
    scoreSuppressed: false,
    safetyNotice: null,
    abstentionReasons: [],
    methodologyVersion: METHODOLOGY_VERSION,
    experimentalScreening: true
  };
}

export { SIGNALS, RESPONSES, LEVERAGE_CLUSTERS };
