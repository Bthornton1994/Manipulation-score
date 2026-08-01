export const SCORE_BANDS = [
  {
    id: 'low',
    label: 'Low',
    min: 0,
    max: 30,
    summary: 'Few or mild language patterns. The message may still feel difficult—context matters more than the score.'
  },
  {
    id: 'moderate',
    label: 'Moderate',
    min: 31,
    max: 60,
    summary: 'Several patterns that may narrow your space to think, question, or respond at your own pace.'
  },
  {
    id: 'high',
    label: 'High',
    min: 61,
    max: 100,
    summary: 'Multiple strong patterns detected. This reflects language, not intent—a starting point for reflection.'
  }
];

const SIGNALS = [
  {
    id: 'guilt',
    label: 'Guilt framing',
    weight: 18,
    pattern: /if you (?:really )?(?:cared|loved)|after all i(?:'ve| have) done|you owe me|selfish|ungrateful/gi,
    detail: 'Care or loyalty is being used as a condition for compliance.',
    education: 'Guilt framing ties your affection or loyalty to a specific action. It can make a normal boundary feel like betrayal.'
  },
  {
    id: 'urgency',
    label: 'Forced urgency',
    weight: 14,
    pattern: /right now|immediately|last chance|before it(?:'s| is) too late|need an answer now|no time/gi,
    detail: 'Time pressure may be limiting your space to think or ask questions.',
    education: 'Forced urgency compresses your decision window. It can push you to agree before you have processed what you need.'
  },
  {
    id: 'threat',
    label: 'Conditional threat',
    weight: 24,
    pattern: /or else|you(?:'ll| will) regret|if you don(?:'t|’t| not)|i(?:'ll| will) leave|never (?:speak|talk) to you/gi,
    detail: 'A negative consequence is tied to doing what the sender wants.',
    education: 'Conditional threats link cooperation to punishment or withdrawal. They can make safety and honesty feel risky.'
  },
  {
    id: 'isolation',
    label: 'Isolation language',
    weight: 22,
    pattern: /they(?:'re| are) against you|only one who understands|don(?:'t|’t) tell (?:them|anyone)|your friends don(?:'t|’t) care|just between us/gi,
    detail: 'The message may discourage outside perspective or support.',
    education: 'Isolation language discourages checking with others. Outside perspective is often healthy—not a threat to the relationship.'
  },
  {
    id: 'dismissal',
    label: 'Reality dismissal',
    weight: 17,
    pattern: /you(?:'re| are) imagining|that never happened|too sensitive|you(?:'re| are) crazy|making things up|overreacting/gi,
    detail: 'Your memory, feelings, or perception may be dismissed rather than discussed.',
    education: 'Reality dismissal challenges your perception instead of engaging with it. Your experience deserves space in the conversation.'
  },
  {
    id: 'absolutes',
    label: 'All-or-nothing framing',
    weight: 9,
    pattern: /\b(?:always|never|everyone|nobody|everything|nothing)\b/gi,
    detail: 'Absolute language can flatten nuance and make disagreement feel impossible.',
    education: 'Words like “always” and “never” turn one moment into a permanent pattern. Specifics are often more accurate than absolutes.'
  },
  {
    id: 'obligation',
    label: 'Obligation pressure',
    weight: 12,
    pattern: /you (?:should|must|have to|need to)|after everything|it's your (?:job|duty|responsibility)/gi,
    detail: 'Obligation language may frame your compliance as required rather than chosen.',
    education: 'Obligation pressure reframes a request as a duty. You can still care about someone without accepting assigned responsibility.'
  },
  {
    id: 'minimization',
    label: 'Minimization',
    weight: 11,
    pattern: /you(?:'re| are) being dramatic|not that bad|calm down|stop being so|you(?:'re| are) too much/gi,
    detail: 'Your reaction may be minimized to shut down the conversation.',
    education: 'Minimization shrinks your reaction to close the topic. Your response size does not prove you are wrong.'
  },
  {
    id: 'withdrawal',
    label: 'Implied withdrawal',
    weight: 16,
    pattern: /i guess i know where i stand|where i stand|don't bother|you'll be sorry|fine, forget it|i'm done trying/gi,
    detail: 'The message may hint at pulling away to pressure you into compliance.',
    education: 'Implied withdrawal suggests you will lose the relationship if you do not comply. It can create fear without stating a clear threat.'
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
    withdrawal: 'I hear that you’re hurt. I still need time before I respond.',
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
    withdrawal: 'I won’t respond to pressure created by hints of leaving.',
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
    withdrawal: 'Are you saying you want to end this, or that you need something from me?',
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

export function getScoreBand(score) {
  if (score <= 30) return SCORE_BANDS[0];
  if (score <= 60) return SCORE_BANDS[1];
  return SCORE_BANDS[2];
}

export function getSignalSeverity(signal) {
  const extra = signal.points - signal.weight;
  if (extra >= 6 || signal.points >= 28) return { label: 'Strong', level: 'strong' };
  if (extra >= 3 || signal.points >= 20) return { label: 'Moderate', level: 'moderate' };
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
  const excerpt = text.slice(start, end);
  const ranges = offsets.map((offset) => ({
    start: offset.start - start,
    end: offset.end - start,
    text: offset.text,
    id: offset.id,
    label: offset.label
  }));
  return {
    excerpt: start > 0 ? `…${excerpt}` : excerpt,
    ranges,
    truncatedEnd: end < text.length
  };
}

export function analyzeMessage(text) {
  const normalized = text.trim();
  if (!normalized) {
    return {
      score: 0,
      level: 'No message',
      band: null,
      bandSummary: '',
      signals: [],
      signalCount: 0,
      responses: buildResponses([]),
      response: RESPONSES.none,
      highlights: [],
      segments: null
    };
  }

  const segments = splitMessages(normalized);
  const segmentAnalyses =
    segments.length > 1
      ? segments.map((segment, index) => ({
          index: index + 1,
          text: segment,
          analysis: analyzeSingleMessage(segment)
        }))
      : null;

  const analysis = analyzeSingleMessage(normalized);
  return { ...analysis, segments: segmentAnalyses };
}

function analyzeSingleMessage(normalized) {
  const signals = SIGNALS.flatMap((signal) => {
    const offsets = findOffsets(normalized, signal.pattern);
    if (!offsets.length) return [];

    const matches = [...new Set(offsets.map((o) => o.text.toLowerCase()))];
    const points = signal.weight + Math.min(8, (offsets.length - 1) * 4);
    const severity = getSignalSeverity({ ...signal, points });
    const responses = getSignalResponses(signal.id);

    return [{
      ...signal,
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

  const score = signals.length
    ? Math.min(100, signals.reduce((total, signal) => total + signal.points, 0))
    : 0;

  const band = getScoreBand(score);
  const responses = buildResponses(signals);
  const highlights = getHighlightRanges(signals);

  return {
    score,
    level: band.label,
    band,
    bandSummary: band.summary,
    signals,
    signalCount: signals.length,
    responses,
    response: responses.pause,
    highlights
  };
}

export { SIGNALS, RESPONSES };
