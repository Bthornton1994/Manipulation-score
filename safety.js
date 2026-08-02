/**
 * Safety classification independent of manipulation-pattern scoring.
 * Evaluates harm candidates per clause with candidate-specific negation.
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
    id: 'stalking',
    pattern: /\bfollow(?:ing)?\s+you\s+home\b/gi
  },
  {
    id: 'stalking',
    pattern: /\bwatch(?:ing)?\s+you\s+through\s+the\s+window\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:waiting|be)\s+outside\s+your\s+(?:work|office|job|home|house)\b/gi
  },
  {
    id: 'stalking',
    pattern: /\bwill\s+be\s+(?:outside|waiting)\b[^.!?]{0,40}\b(?:office|work|home|house)\b/gi
  },
  {
    id: 'stalking',
    pattern: /\boutside\s+your\s+office\s+when\s+you\s+leave\b/gi
  },
  {
    id: 'stalking',
    pattern: /\byou\s+cannot\s+hide\s+from\s+me\b/gi
  },
  {
    id: 'stalking',
    pattern: /\bi\s+am\s+watching\s+you\b/gi
  },
  {
    id: 'stalking',
    pattern:
      /\bknow\s+where\s+you\s+work\b[^.!?]{0,120}\b(?:waiting|watching|following|cannot\s+hide|outside)\b/gi
  },
  {
    id: 'stalking',
    pattern:
      /\bknow\s+where\s+you\s+work\b[^.!?]{0,40}\b(?:and|,)+\s*(?:i\s+)?(?:am\s+)?(?:watching|waiting|following)\b/gi
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

const CLAUSE_SPLIT_RE = /\s*;\s*|\s+\bbut\s+|\s+\bhowever\s+|\s+\byet\s+/gi;

const THIRD_PARTY_ATTRIBUTION =
  /(?:character|villain|actor|suspect|defendant|attacker|witness|police|they|he|she|someone)\s+said\b/i;

const REPORTED_QUOTE_ATTRIBUTION =
  /(?:article|report|news|story|headline)\s+(?:said|reported|quoted|described)\b/i;

const INSTRUCTIONAL_ATTRIBUTION =
  /(?:instructor|trainer|teacher|facilitator|coach)\s+(?:used|quoted|said|showed|gave)\b/i;

const TRAINING_SEGMENT =
  /(?:safety|workplace|de-?escalation|crisis\s+line)\s+training|training\s+example|fictional\s+(?:scene|dialogue|example)|in\s+a\s+(?:movie|book|script|novel)/i;

const TRAINING_EXAMPLE_PHRASE =
  /as\s+an\s+example|example\s+of\s+threatening\s+language|training\s+scenario|fictional\s+training/i;

const MEDICAL_CONTEXT = /\b(?:doctor|treatment|medication|procedure|therapy)\b/i;

const NEGATION_WORD =
  '(?:never|not|no|cannot|can\'t|won\'t|would\\s+never|do\\s+not|don\'t|does\\s+not|doesn\'t|should\\s+not|shouldn\'t|wouldn\'t)';

function normalizeForSafety(text) {
  return (text || '')
    .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
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

/**
 * @returns {{ text: string, start: number, end: number }[]}
 */
function splitClauses(segmentText) {
  const clauses = [];
  let lastEnd = 0;
  CLAUSE_SPLIT_RE.lastIndex = 0;
  let splitMatch;

  while ((splitMatch = CLAUSE_SPLIT_RE.exec(segmentText)) !== null) {
    const chunk = segmentText.slice(lastEnd, splitMatch.index).trim();
    if (chunk) {
      const start = segmentText.indexOf(chunk, lastEnd);
      clauses.push({ text: chunk, start, end: start + chunk.length });
    }
    lastEnd = splitMatch.index + splitMatch[0].length;
  }

  const tail = segmentText.slice(lastEnd).trim();
  if (tail) {
    const start = segmentText.indexOf(tail, lastEnd);
    clauses.push({ text: tail, start, end: start + tail.length });
  }

  if (!clauses.length && segmentText.trim()) {
    const trimmed = segmentText.trim();
    clauses.push({ text: trimmed, start: 0, end: trimmed.length });
  }

  return clauses;
}

function findCandidates(clauseText) {
  const matches = [];

  for (const rule of CANDIDATE_RULES) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let match;
    while ((match = re.exec(clauseText)) !== null) {
      matches.push({
        id: rule.id,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

function extractHarmVerb(matchText) {
  const verb = matchText.match(/\b(kill|hurt|harm|murder|shoot|stab)\b/i);
  return verb ? verb[1].toLowerCase() : null;
}

function isNegatedForCandidate(clauseText, matchStart, matchText) {
  const harmVerb = extractHarmVerb(matchText);
  if (!harmVerb) return false;

  const prefix = clauseText.slice(0, matchStart);
  const escaped = harmVerb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidatePhrase = clauseText.slice(matchStart, matchStart + matchText.length);

  const negatedVerb = new RegExp(
    `\\b${NEGATION_WORD}(?:\\s+\\w+){0,8}\\s+${escaped}\\b`,
    'i'
  );
  if (negatedVerb.test(prefix + candidatePhrase)) return true;

  if (harmVerb === 'hurt' || harmVerb === 'harm') {
    if (
      new RegExp(
        `\\b${NEGATION_WORD}(?:\\s+\\w+){0,12}\\b(?:want\\s+to\\s+)?(?:hurt|harm)\\s+you\\b`,
        'i'
      ).test(prefix + candidatePhrase)
    ) {
      return true;
    }
  }

  return false;
}

function isThirdPartyQuote(clauseText, matchStart) {
  const before = clauseText.slice(0, matchStart);
  const recent = before.slice(-120);
  if (THIRD_PARTY_ATTRIBUTION.test(recent)) return true;
  if (REPORTED_QUOTE_ATTRIBUTION.test(recent) && /["']/.test(recent)) return true;
  return false;
}

function isInstructionalQuote(clauseText, matchStart) {
  const before = clauseText.slice(0, matchStart);
  const recent = before.slice(-140);

  if (INSTRUCTIONAL_ATTRIBUTION.test(recent)) {
    if (TRAINING_EXAMPLE_PHRASE.test(clauseText) || /during\s+(?:safety\s+)?training/i.test(clauseText)) {
      return true;
    }
  }

  if (
    /during\s+(?:safety\s+)?training/i.test(clauseText.slice(0, matchStart + 20)) &&
    TRAINING_EXAMPLE_PHRASE.test(clauseText)
  ) {
    const firstPersonBefore =
      /\b(?:i'?m|i am|i will|i'?ll)\s+(?:going\s+to|will)\s+(?:kill|hurt|harm|shoot|stab)/i.test(
        clauseText.slice(0, matchStart)
      );
    if (!firstPersonBefore) return true;
  }

  return false;
}

function isTrainingOnlyClause(clauseText) {
  if (!TRAINING_SEGMENT.test(clauseText)) return false;
  const firstPersonThreat =
    /\b(?:i'?m|i am|i will|i'?ll)\s+(?:going\s+to|will)\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you\b/i.test(
      clauseText
    );
  return !firstPersonThreat;
}

function isConsensualStalkingContext(clauseText, matchStart, matchId) {
  if (matchId !== 'stalking') return false;

  const local = clauseText.slice(
    Math.max(0, matchStart - 40),
    Math.min(clauseText.length, matchStart + 100)
  );

  if (/\bif\s+you\s+want\b/i.test(local)) return true;
  if (/\bto\s+make\s+sure\s+you\s+arrive\s+safely\b/i.test(clauseText)) return true;

  if (
    /\bknow\s+where\s+you\s+work\b/i.test(clauseText) &&
    /\bbecause\s+we\s+met\s+there\b/i.test(clauseText) &&
    !/\b(?:waiting|watching|following|hide|outside|cannot)\b/i.test(clauseText)
  ) {
    return true;
  }

  return false;
}

function isMedicalReassurance(clauseText, matchStart, matchText) {
  const before = clauseText.slice(Math.max(0, matchStart - 80), matchStart);
  if (!MEDICAL_CONTEXT.test(before)) return false;
  return /\bshould\s+not\s+harm\b/i.test(
    clauseText.slice(Math.max(0, matchStart - 20), matchStart + matchText.length)
  );
}

function isExcludedCandidate(clauseText, match) {
  if (isNegatedForCandidate(clauseText, match.start, match.text)) return true;
  if (isConsensualStalkingContext(clauseText, match.start, match.id)) return true;
  if (isThirdPartyQuote(clauseText, match.start)) return true;
  if (isInstructionalQuote(clauseText, match.start)) return true;
  if (isTrainingOnlyClause(clauseText)) return true;
  if (isMedicalReassurance(clauseText, match.start, match.text)) return true;
  return false;
}

/**
 * @returns {typeof SAFETY_NOTICE & { category?: string, evidenceSpan?: { start: number, end: number, text: string } } | null}
 */
export function detectSafetyNotice(text) {
  const normalized = normalizeForSafety(text);
  if (!normalized) return null;

  const sentences = splitSentences(normalized);

  for (const sentence of sentences) {
    const clauses = splitClauses(sentence.text);

    for (const clause of clauses) {
      const candidates = findCandidates(clause.text);

      for (const candidate of candidates) {
        if (isExcludedCandidate(clause.text, candidate)) continue;

        const globalStart = sentence.start + clause.start + candidate.start;
        const globalEnd = sentence.start + clause.start + candidate.end;

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
  }

  return null;
}
