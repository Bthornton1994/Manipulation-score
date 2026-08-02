/**
 * Safety classification independent of manipulation-pattern scoring.
 * Detects explicit harm language — not a diagnosis of danger.
 */

const HARM_THREAT_PATTERNS = [
  /\b(i will|i'll|im going to|i am going to)\s+(hurt|harm|kill)\s+you\b/i,
  /\b(i will|i'll)\s+make\s+you\s+(hurt|pay|suffer)\b/i,
  /\bhurt\s+you\s+if\b/i,
  /\bif\s+you\s+leave\b[^.!?]{0,40}\b(hurt|harm|kill)\b/i,
  /\bif\s+you\s+leave\b[^.!?]{0,20}\b(i will|i'll)\b[^.!?]{0,20}\b(hurt|harm|kill)\b/i
];

export const SAFETY_NOTICE = {
  id: 'conditional_harm_language',
  headline: 'Safety notice — not a safety assessment',
  summary:
    'This message includes language about harm or violence. Clarity cannot determine whether you are in danger. If you feel unsafe, contact local emergency services or a trusted crisis resource.',
  resourcesAnchor: '#resources'
};

/**
 * @returns {typeof SAFETY_NOTICE | null}
 */
export function detectSafetyNotice(text) {
  const normalized = (text || '').trim();
  if (!normalized) return null;

  for (const pattern of HARM_THREAT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ...SAFETY_NOTICE };
    }
  }

  return null;
}
