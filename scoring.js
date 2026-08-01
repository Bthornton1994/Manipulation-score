const SIGNALS = [
  {
    id: 'guilt',
    label: 'Guilt framing',
    weight: 18,
    pattern: /if you (?:really )?(?:cared|loved)|after all i(?:'ve| have) done|you owe me|selfish|ungrateful/gi,
    detail: 'Care or loyalty is being used as a condition for compliance.'
  },
  {
    id: 'urgency',
    label: 'Forced urgency',
    weight: 14,
    pattern: /right now|immediately|last chance|before it(?:'s| is) too late|need an answer now|no time/gi,
    detail: 'Time pressure may be limiting your space to think or ask questions.'
  },
  {
    id: 'threat',
    label: 'Conditional threat',
    weight: 24,
    pattern: /or else|you(?:'ll| will) regret|if you don(?:'t|’t| not)|i(?:'ll| will) leave|never (?:speak|talk) to you/gi,
    detail: 'A negative consequence is tied to doing what the sender wants.'
  },
  {
    id: 'isolation',
    label: 'Isolation language',
    weight: 22,
    pattern: /they(?:'re| are) against you|only one who understands|don(?:'t|’t) tell (?:them|anyone)|your friends don(?:'t|’t) care|just between us/gi,
    detail: 'The message may discourage outside perspective or support.'
  },
  {
    id: 'dismissal',
    label: 'Reality dismissal',
    weight: 17,
    pattern: /you(?:'re| are) imagining|that never happened|too sensitive|you(?:'re| are) crazy|making things up|overreacting/gi,
    detail: 'Your memory, feelings, or perception may be dismissed rather than discussed.'
  },
  {
    id: 'absolutes',
    label: 'All-or-nothing framing',
    weight: 9,
    pattern: /\b(?:always|never|everyone|nobody|everything|nothing)\b/gi,
    detail: 'Absolute language can flatten nuance and make disagreement feel impossible.'
  },
  {
    id: 'obligation',
    label: 'Obligation pressure',
    weight: 12,
    pattern: /you (?:should|must|have to|need to)|after everything|it's your (?:job|duty|responsibility)/gi,
    detail: 'Obligation language may frame your compliance as required rather than chosen.'
  },
  {
    id: 'minimization',
    label: 'Minimization',
    weight: 11,
    pattern: /you(?:'re| are) being dramatic|not that bad|calm down|stop being so|you(?:'re| are) too much/gi,
    detail: 'Your reaction may be minimized to shut down the conversation.'
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
    default: 'I want to make sure I understand. Can you tell me more about what you need?'
  },
  none: 'I want to make sure I understand. Can you tell me more about what you need?'
};

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

export function analyzeMessage(text) {
  const normalized = text.trim();
  if (!normalized) {
    return {
      score: 0,
      level: 'No message',
      signals: [],
      signalCount: 0,
      responses: buildResponses([]),
      response: RESPONSES.none,
      highlights: []
    };
  }

  const signals = SIGNALS.flatMap((signal) => {
    const offsets = findOffsets(normalized, signal.pattern);
    if (!offsets.length) return [];

    const matches = [...new Set(offsets.map((o) => o.text.toLowerCase()))];
    const points = signal.weight + Math.min(8, (offsets.length - 1) * 4);

    return [{ ...signal, matches, offsets, points }];
  });

  const score = signals.length
    ? Math.min(100, signals.reduce((total, signal) => total + signal.points, 0))
    : 0;

  const level =
    score >= 60 ? 'High pressure'
    : score >= 38 ? 'Elevated pressure'
    : score >= 18 ? 'Some pressure'
    : 'Low pressure';

  const responses = buildResponses(signals);
  const highlights = getHighlightRanges(signals);

  return {
    score,
    level,
    signals,
    signalCount: signals.length,
    responses,
    response: responses.pause,
    highlights
  };
}

export { SIGNALS };
