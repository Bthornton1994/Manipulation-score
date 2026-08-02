/**
 * Safety classification independent of manipulation-pattern scoring.
 * Detects explicit harm language — not a diagnosis of danger.
 * Evaluates candidates per sentence with local negation and attribution.
 */

export const SAFETY_NOTICE = {
  id: 'conditional_harm_language',
  headline: 'Safety notice — not a safety assessment',
  summary:
    'This message includes language about harm, violence, or coercion. Clarity cannot determine whether you are in danger. If you feel unsafe, contact local emergency services or a trusted crisis resource.',
  resourcesAnchor: '#resources'
};

const CANDIDATE_RULES = [
  {
    id: 'direct_violence',
    pattern:
      /(?:i'?m|i am|im)\s+going\s+to\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you/gi
  },
  {
    id: 'direct_violence',
    pattern: /(?:i will|i'?ll|iwll)\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you/gi
  },
  {
    id: 'direct_violence',
    pattern: /(?:i will|i'?ll)\s+make\s+you\s+(?:hurt|pay|suffer)/gi
  },
  {
    id: 'direct_violence',
    pattern: /\b(?:kill|hurt|harm|murder)\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\bhurt\s+you\s+if\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\bif\s+you\s+leave\b[^.!?]{0,50}\b(?:hurt|harm|kill|murder)\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\bif\s+you\s+leave\b[^.!?]{0,30}\b(?:i will|i'?ll)\b[^.!?]{0,30}\b(?:hurt|harm|kill)\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /(?:kill|hurt)\s+myself\s+if\s+you/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\bif\s+you\s+leave\b[^.!?]{0,60}\b(?:kill|hurt)\s+myself/gi
  },
  {
    id: 'self_harm_coercion',
    pattern:
      /(?:kill myself|hurt myself|end my life).{0,50}(?:your fault|because of you|you made me|if you leave)/gi
  },
  {
    id: 'self_harm_coercion',
    pattern:
      /(?:your fault|because of you|you made me).{0,50}(?:kill myself|hurt myself|end my life|suicide)/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /(?:suicide|kill myself).{0,40}(?:your fault|because of you)/gi
  },
  {
    id: 'stalking',
    pattern: /\bknow\s+where\s+you\s+live\b/gi
  },
  {
    id: 'stalking',
    pattern: /(?:come|going)\s+(?:to\s+)?find\s+you/gi
  },
  {
    id: 'stalking',
    pattern: /(?:come|going)\s+to\s+your\s+(?:house|home|apartment|place)/gi
  },
  {
    id: 'stalking',
    pattern: /\bfind\s+you\s+(?:tonight|today|this\s+night)/gi
  },
  {
    id: 'stalking',
    pattern: /(?:show up|come)\s+(?:at|to)\s+your\b[^.!?]{0,30}(?:tonight|today)/gi
  },
  {
    id: 'weapon_threat',
    pattern: /(?:gun|knife|weapon|pistol|rifle|machete).{0,35}(?:you|threaten|pointed)/gi
  },
  {
    id: 'weapon_threat',
    pattern: /(?:shoot|stab)\s+you/gi
  },
  {
    id: 'weapon_threat',
    pattern: /\bpoint\s+(?:a\s+)?(?:gun|knife|weapon)\s+at\s+you/gi
  },
  {
    id: 'confinement',
    pattern: /won'?t\s+let\s+you\s+(?:leave|go|out|escape)/gi
  },
  {
    id: 'confinement',
    pattern: /(?:lock|locking)\s+(?:you\s+in|the\s+door|you\s+inside)/gi
  },
  {
    id: 'confinement',
    pattern: /(?:trapped|trapping)\s+you\b/gi
  },
  {
    id: 'emergency_coercion',
    pattern: /call\s+911\b[^.!?]{0,40}\b(?:or|unless)\b[^.!?]{0,40}\b(?:die|hurt|kill)/gi
  }
];

const NEGATION_NEAR_HARM =
  /\b(?:never|not|no|cannot|can't|won't|would\s+never|do\s+not|don't|does\s+not|doesn't|should\s+not|shouldn't|wouldn't)\b[^.!?]{0,32}\b(?:kill|hurt|harm|murder|shoot|stab)\b/i;

const THIRD_PARTY_ATTRIBUTION =
  /(?:character|villain|actor|suspect|defendant|attacker|witness|police|suspect|they|he|she|someone)\s+said\b/i;

const REPORTED_QUOTE_ATTRIBUTION =
  /(?:article|report|news|story|headline)\s+(?:said|reported|quoted|described)\b/i;

const TRAINING_SEGMENT =
  /(?:safety|workplace|de-?escalation|crisis\s+line)\s+training|training\s+example|fictional\s+(?:scene|dialogue|example)|in\s+a\s+(?:movie|book|script|novel)/i;

const MEDICAL_CONTEXT = /\b(?:doctor|treatment|medication|procedure|therapy)\b/i;

function normalizeForSafety(text) {
  return (text || '')
    .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @returns {{ text: string, start: number, end: number }[]}
 */
function splitSegments(text) {
  const segments = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lead = raw.indexOf(trimmed);
    const start = match.index + lead;
    const end = start + trimmed.length;
    segments.push({ text: trimmed, start, end });
  }

  if (!segments.length && text) {
    segments.push({ text, start: 0, end: text.length });
  }

  return segments;
}

function findCandidates(segmentText) {
  const matches = [];

  for (const rule of CANDIDATE_RULES) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let match;
    while ((match = re.exec(segmentText)) !== null) {
      matches.push({
        id: rule.id,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  return matches;
}

function isNegatedHarm(segmentText, matchStart, matchText) {
  const localStart = Math.max(0, matchStart - 8);
  const localEnd = Math.min(segmentText.length, matchStart + matchText.length + 8);
  const window = segmentText.slice(localStart, localEnd);
  const beforeHarm = segmentText.slice(Math.max(0, matchStart - 48), matchStart + matchText.length);

  if (NEGATION_NEAR_HARM.test(beforeHarm)) return true;

  if (
    /\b(?:do\s+not|don't|would\s+never|should\s+not|shouldn't)\b[^.!?]{0,40}\b(?:want\s+to\s+)?(?:hurt|harm|kill)\s+you\b/i.test(
      window
    )
  ) {
    return true;
  }

  return false;
}

function isThirdPartyQuote(segmentText, matchStart) {
  const before = segmentText.slice(0, matchStart);
  const recent = before.slice(-120);
  if (THIRD_PARTY_ATTRIBUTION.test(recent)) return true;
  if (REPORTED_QUOTE_ATTRIBUTION.test(recent) && /["']/.test(recent)) return true;
  return false;
}

function isTrainingOnlySegment(segmentText) {
  if (!TRAINING_SEGMENT.test(segmentText)) return false;
  const firstPersonThreat =
    /\b(?:i'?m|i am|i will|i'?ll)\s+(?:going\s+to|will)\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you\b/i.test(
      segmentText
    );
  return !firstPersonThreat;
}

function isMedicalReassurance(segmentText, matchStart, matchText) {
  const before = segmentText.slice(Math.max(0, matchStart - 80), matchStart);
  if (!MEDICAL_CONTEXT.test(before)) return false;
  return /\bshould\s+not\s+harm\b/i.test(
    segmentText.slice(Math.max(0, matchStart - 20), matchStart + matchText.length)
  );
}

function isExcludedCandidate(segmentText, match) {
  if (isNegatedHarm(segmentText, match.start, match.text)) return true;
  if (isThirdPartyQuote(segmentText, match.start)) return true;
  if (isTrainingOnlySegment(segmentText)) return true;
  if (isMedicalReassurance(segmentText, match.start, match.text)) return true;
  return false;
}

/**
 * @returns {typeof SAFETY_NOTICE & { category?: string, evidenceSpan?: { start: number, end: number, text: string } } | null}
 */
export function detectSafetyNotice(text) {
  const normalized = normalizeForSafety(text);
  if (!normalized) return null;

  const segments = splitSegments(normalized);

  for (const segment of segments) {
    const candidates = findCandidates(segment.text);

    for (const candidate of candidates) {
      if (isExcludedCandidate(segment.text, candidate)) continue;

      const globalStart = segment.start + candidate.start;
      const globalEnd = segment.start + candidate.end;

      return {
        ...SAFETY_NOTICE,
        category: candidate.id,
        evidenceSpan: {
          start: globalStart,
          end: globalEnd,
          text: normalized.slice(globalStart, globalEnd)
        }
      };
    }
  }

  return null;
}
