/**
 * Safety classification independent of manipulation-pattern scoring.
 * Detects explicit harm language — not a diagnosis of danger.
 */

export const SAFETY_NOTICE = {
  id: 'conditional_harm_language',
  headline: 'Safety notice — not a safety assessment',
  summary:
    'This message includes language about harm, violence, or coercion. Clarity cannot determine whether you are in danger. If you feel unsafe, contact local emergency services or a trusted crisis resource.',
  resourcesAnchor: '#resources'
};

const SAFETY_BENIGN_CONTEXT = [
  /safety\s+training/i,
  /workplace\s+training/i,
  /in\s+the\s+(?:news|article|story|book|script)/i,
  /(?:character|villain|actor)\s+said/i,
  /fictional\s+(?:scene|dialogue|example)/i,
  /de-?escalation\s+training/i,
  /crisis\s+line\s+training/i
];

const SAFETY_PATTERNS = [
  // Direct violence (contractions, curly apostrophes normalized)
  /(?:i'?m|i am|im)\s+going\s+to\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you/i,
  /(?:i will|i'?ll|iwll)\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you/i,
  /(?:i will|i'?ll)\s+make\s+you\s+(?:hurt|pay|suffer)/i,
  /\b(?:kill|hurt|harm|murder)\s+you\b/i,
  /\bhurt\s+you\s+if\b/i,
  /\bif\s+you\s+leave\b[^.!?]{0,50}\b(?:hurt|harm|kill|murder)\b/i,
  /\bif\s+you\s+leave\b[^.!?]{0,30}\b(?:i will|i'?ll)\b[^.!?]{0,30}\b(?:hurt|harm|kill)\b/i,
  // Self-harm and suicide coercion
  /(?:kill|hurt)\s+myself\s+if\s+you/i,
  /if\s+you\s+leave\b[^.!?]{0,60}\b(?:kill|hurt)\s+myself/i,
  /(?:kill myself|hurt myself|end my life).{0,50}(?:your fault|because of you|you made me|if you leave)/i,
  /(?:your fault|because of you|you made me).{0,50}(?:kill myself|hurt myself|end my life|suicide)/i,
  /(?:suicide|kill myself).{0,40}(?:your fault|because of you)/i,
  // Stalking, location, and “coming to find you” threats
  /\bknow\s+where\s+you\s+live\b/i,
  /(?:come|going)\s+(?:to\s+)?find\s+you/i,
  /(?:come|going)\s+to\s+your\s+(?:house|home|apartment|place)/i,
  /\bfind\s+you\s+(?:tonight|today|this\s+night)/i,
  /(?:show up|come)\s+(?:at|to)\s+your\b[^.!?]{0,30}(?:tonight|today)/i,
  // Weapon threats
  /(?:gun|knife|weapon|pistol|rifle|machete).{0,35}(?:you|threaten|pointed)/i,
  /(?:shoot|stab)\s+you/i,
  /\bpoint\s+(?:a\s+)?(?:gun|knife|weapon)\s+at\s+you/i,
  // Emergency coercion and confinement
  /won'?t\s+let\s+you\s+(?:leave|go|out|escape)/i,
  /(?:lock|locking)\s+(?:you\s+in|the\s+door|you\s+inside)/i,
  /(?:trapped|trapping)\s+you\b/i,
  /call\s+911\b[^.!?]{0,40}\b(?:or|unless)\b[^.!?]{0,40}\b(?:die|hurt|kill)/i
];

function normalizeForSafety(text) {
  return (text || '')
    .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isBenignSafetyContext(normalized) {
  return SAFETY_BENIGN_CONTEXT.some((pattern) => pattern.test(normalized));
}

/**
 * @returns {typeof SAFETY_NOTICE | null}
 */
export function detectSafetyNotice(text) {
  const normalized = normalizeForSafety(text);
  if (!normalized) return null;
  if (isBenignSafetyContext(normalized)) return null;

  for (const pattern of SAFETY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ...SAFETY_NOTICE };
    }
  }

  return null;
}
