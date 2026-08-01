const SIGNALS = [
  { id: 'guilt', label: 'Guilt framing', weight: 18, pattern: /if you (?:really )?(?:cared|loved)|after all i(?:'ve| have) done|you owe me|selfish|ungrateful/gi, detail: 'Care or loyalty is being used as a condition for compliance.' },
  { id: 'urgency', label: 'Forced urgency', weight: 14, pattern: /right now|immediately|last chance|before it(?:'s| is) too late|need an answer now|no time/gi, detail: 'Time pressure may be limiting your space to think or ask questions.' },
  { id: 'threat', label: 'Conditional threat', weight: 24, pattern: /or else|you(?:'ll| will) regret|if you don(?:'t|’t| not)|i(?:'ll| will) leave|never (?:speak|talk) to you/gi, detail: 'A negative consequence is tied to doing what the sender wants.' },
  { id: 'isolation', label: 'Isolation language', weight: 22, pattern: /they(?:'re| are) against you|only one who understands|don(?:'t|’t) tell (?:them|anyone)|your friends don(?:'t|’t) care|just between us/gi, detail: 'The message may discourage outside perspective or support.' },
  { id: 'dismissal', label: 'Reality dismissal', weight: 17, pattern: /you(?:'re| are) imagining|that never happened|too sensitive|you(?:'re| are) crazy|making things up|overreacting/gi, detail: 'Your memory, feelings, or perception may be dismissed rather than discussed.' },
  { id: 'absolutes', label: 'All-or-nothing framing', weight: 9, pattern: /\b(?:always|never|everyone|nobody|everything|nothing)\b/gi, detail: 'Absolute language can flatten nuance and make disagreement feel impossible.' }
];

export function analyzeMessage(text) {
  const normalized = text.trim();
  if (!normalized) return { score: 0, level: 'No message', signals: [], response: '' };
  const signals = SIGNALS.flatMap((signal) => {
    const evidence = [...normalized.matchAll(signal.pattern)].map((match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    }));
    const matches = [...new Set(evidence.map(({ text: match }) => match.toLowerCase()))];
    return evidence.length ? [{ ...signal, matches, evidence, points: signal.weight + Math.min(8, (evidence.length - 1) * 4) }] : [];
    const matches = normalized.match(signal.pattern) || [];
    return matches.length ? [{ ...signal, matches: [...new Set(matches.map((match) => match.toLowerCase()))], points: signal.weight + Math.min(8, (matches.length - 1) * 4) }] : [];
  });
  const score = Math.min(100, signals.reduce((total, signal) => total + signal.points, 4));
  const level = score >= 60 ? 'High pressure' : score >= 38 ? 'Elevated pressure' : score >= 18 ? 'Some pressure' : 'Low pressure';
  const response = signals.length
    ? 'I hear that this matters to you. I need time to think, and I’ll respond when I’m ready.'
    : 'I want to make sure I understand. Can you tell me more about what you need?';
  return { score, level, signals, response, signalCount: signals.length };
  return { score, level, signals, response };
}

export { SIGNALS };
