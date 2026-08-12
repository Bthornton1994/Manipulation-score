/**
 * Safety classification independent of manipulation-pattern scoring.
 * Direct violence is immediate; stalking requires behavior plus menace or severe intrusion.
 */

import { normalizeAnalysisText, normalizeForMatching, splitMessageBlocks } from './text-normalize.js';

export const SAFETY_NOTICE = {
  id: 'conditional_harm_language',
  headline: 'Safety notice — not a safety assessment',
  summary:
    'This message includes language about harm, violence, or coercion. Clarity cannot determine whether you are in danger. If you feel unsafe, contact local emergency services or a trusted crisis resource.',
  resourcesAnchor: '#resources'
};

const IMMEDIATE_RULES = [
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+burn\s+you\s+alive\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+break\s+your\s+neck\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+cut\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+drown\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+poison\s+your\s+(?:drink|food)\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+run\s+you\s+over\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+smash\s+your\s+face\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+make\s+sure\s+you\s+never\s+wake\s+up\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:(?:i will|i'll)|(?:i'?m|i am)\s+going\s+to)\s+put\s+you\s+in\s+the\s+hospital\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\b(?:i'?m|i am)\s+going\s+to\s+(?:beat|choke)\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern:
      /\b(?:i'?m|i am|im)\s+going\s+to\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\b(?:i will|i'll)\s+(?:kill|hurt|harm|shoot|stab|murder)\s+you\b/gi
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
    id: 'weapon_threat',
    pattern: /(?:gun|knife|weapon|pistol|rifle|machete).{0,35}(?:\byou\b|threaten|pointed)/gi
  },
  {
    id: 'weapon_threat',
    pattern: /\b(?:shoot|stab)\s+you\b/gi
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
    pattern: /will\s+not\s+let\s+you\s+(?:leave|go|out|escape)/gi
  },
  {
    id: 'confinement',
    pattern: /won'?t\s+let\s+you\s+leave\b[^.!?]{0,50}\buntil\b/gi
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
    id: 'confinement',
    pattern: /\blocked\s+the\s+door\s+so\s+you\s+cannot\s+leave\b/gi
  },
  {
    id: 'confinement',
    pattern: /\byou\s+(?:are\s+not|aren't|will\s+not|won't)\s+(?:leaving|leave)\b[^.!?]{0,70}\buntil\b/gi
  },
  {
    id: 'confinement',
    pattern: /\b(?:i\s+)?blocked\s+the\s+exit\b[^.!?]{0,50}\byou\s+cannot\s+(?:go|leave|escape)\b/gi
  },
  {
    id: 'confinement',
    pattern: /\b(?:i\s+am|i'm)\s+standing\s+in\s+front\s+of\s+the\s+door\b[^.!?]{0,50}\byou\s+cannot\s+leave\b/gi
  },
  {
    id: 'confinement',
    pattern: /\b(?:i\s+)?took\s+your\s+keys\b[^.!?]{0,50}\byou\s+cannot\s+get\s+away\b/gi
  },
  {
    id: 'confinement',
    pattern: /\b(?:i will|i'll)\s+not\s+allow\s+you\s+out\s+of\b[^.!?]{0,50}\buntil\b/gi
  },
  {
    id: 'confinement',
    pattern: /\bdoors?\s+(?:are|is)\s+locked\b[^.!?]{0,50}\byou\s+(?:are|will\s+be)\s+staying\s+here\b/gi
  },
  {
    id: 'confinement',
    pattern: /\b(?:i\s+)?locked\s+you\s+inside\b[^.!?]{0,50}\b(?:hid|hidden)\s+the\s+key\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+)?know\s+your\s+work\s+schedule\b[^.!?]{0,70}\bwaiting\s+when\s+you\s+leave\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+am|i'm)\s+outside\s+your\s+house\b[^.!?]{0,70}\b(?:told|asked)\s+me\s+to\s+leave\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i will|i'll)\s+find\s+you\b[^.!?]{0,70}\beven\s+if\s+you\s+change\s+your\s+address\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+)?installed\s+a\s+tracker\s+in\s+your\s+(?:phone|device)\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+)?placed\s+a\s+camera\s+outside\s+your\s+window\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+)?sit\s+in\s+my\s+car\s+near\s+your\s+(?:office|work)\b[^.!?]{0,50}\bwatch\s+when\s+you\s+leave\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i will|i'll)\s+follow\s+you\s+from\s+work\b[^.!?]{0,60}\buntil\s+you\b/gi
  },
  {
    id: 'stalking',
    pattern: /\b(?:i\s+am|i'm)\s+waiting\s+outside\b[^.!?]{0,70}\b(?:asked|told)\s+me\s+to\s+stop\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\bend\s+(?:this|our)\s+relationship\b[^.!?]{0,60}\bi\s+will\s+not\s+be\s+alive\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\bi\s+have\s+all\s+the\s+pills\s+ready\b[^.!?]{0,70}\bif\s+you\s+(?:decide\s+to\s+)?(?:leave|walk\s+away|end)\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\bif\s+you\s+block\s+me\b[^.!?]{0,70}\bi\s+will\s+hurt\s+myself\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\byour\s+decision\s+to\s+leave\b[^.!?]{0,70}\b(?:i\s+)?end\s+my\s+life\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\bwill\s+beat\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\bwill\s+choke\s+you\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\byou\s+are\s+dead\s+when\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\bwatch\s+your\s+back\b/gi
  },
  {
    id: 'direct_violence',
    pattern: /\b(?:i\s+am\s+)?coming\s+for\s+you\b/gi
  },
  {
    id: 'stalking',
    pattern: /\btracker\s+on\s+your\s+car\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\bwill\s+end\s+it\b[^.!?]{0,50}\bif\s+you\s+go\b/gi
  },
  {
    id: 'self_harm_coercion',
    pattern: /\btake\s+all\s+these\s+pills\b[^.!?]{0,60}\bif\s+you\s+end\b/gi
  },
  {
    id: 'emergency_coercion',
    pattern: /call\s+911\b[^.!?]{0,40}\b(?:or|unless)\b[^.!?]{0,40}\b(?:die|hurt|kill)/gi
  }
];

const STALKING_BEHAVIORS = [
  { severe: true, pattern: /\bwatch(?:ing)?\s+you\s+through\s+the\s+window\b/gi },
  { severe: true, pattern: /\byou\s+cannot\s+hide\s+from\s+me\b/gi },
  { pattern: /\bknow\s+where\s+you\s+(?:live|work)\b/gi },
  {
    pattern:
      /\b(?:i\s+am\s+)?(?:come|coming|going)\s+to\s+your\s+(?:house|home|apartment|place|office)\b/gi
  },
  { pattern: /\b(?:come|going)\s+to\s+your\s+(?:house|home|apartment|place)\b/gi },
  { pattern: /\bfollow(?:ing)?\s+you\s+home\b/gi },
  { pattern: /\b(?:waiting|be)\s+outside\s+your\s+(?:work|office|job|home|house)\b/gi },
  {
    pattern: /\bwill\s+be\s+(?:outside|waiting)\b[^.!?]{0,40}\b(?:office|work|home|house)\b/gi
  },
  { pattern: /\boutside\s+your\s+office\s+when\s+you\s+leave\b/gi },
  { pattern: /\bi\s+am\s+watching\s+you\b/gi },
  { pattern: /(?:come|going)\s+(?:to\s+)?find\s+you\b/gi },
  { pattern: /\bfind\s+you\s+(?:tonight|today|this\s+night)\b/gi },
  { pattern: /(?:show up|come)\s+(?:at|to)\s+your\b[^.!?]{0,30}(?:tonight|today)\b/gi }
];

const MENACE_PATTERNS = [
  /whether\s+you\s+want\s+(?:me\s+)?(?:to\s+or\s+not|there\s+or\s+not)/i,
  /you\s+cannot\s+stop\s+me/i,
  /you\s+can't\s+stop\s+me/i,
  /you\s+cannot\s+hide(?:\s+from\s+me)?/i,
  /without\s+your\s+permission/i,
  /invited\s+or\s+not/i,
  /even\s+though\s+you\s+told\s+me\s+to\s+stop/i,
  /after\s+you\s+said\s+no/i,
  /\byou\s+said\s+no\b/i,
  /\btold\s+me\s+to\s+stop\b/i,
  /\btold\s+me\s+to\s+leave\b/i,
  /\basked\s+me\s+to\s+leave\b/i,
  /\btold\s+me\s+to\s+go\s+away\b/i,
  /\basked\s+me\s+to\s+stop\s+waiting\b/i,
  /\basked\s+me\s+to\s+stop\b/i
];

const BENIGN_CONSENT_PATTERNS = [
  /you\s+invited\s+me/i,
  /unless\s+you\s+invite\s+me/i,
  /would\s+you\s+like\s+me\s+to/i,
  /\bif\s+you\s+want\b/i,
  /package\s+you\s+requested/i,
  /you\s+sent\s+me\s+your\s+address/i,
  /keep\s+it\s+private/i,
  /respect\s+your\s+(?:privacy|boundaries|decision|space)/i,
  /\bunless\s+you\s+(?:ask|give|invite)\b/i,
  /because\s+we\s+met\s+there/i,
  /to\s+make\s+sure\s+you\s+arrive\s+safely/i,
  /help\s+you\s+move/i,
  /drop\s+off\s+the\s+package/i,
  /leave\s+it\s+outside/i,
  /\bwill\s+not\s+(?:come|visit|call|share)\b/i,
  /\bnot\s+coming\s+to\s+your\b/i,
  /for\s+the\s+dinner\s+you\s+invited/i,
  /dinner\s+you\s+invited/i,
  /another\s+day\s+be\s+better/i,
  /for\s+the\s+invitation/i,
  /\bride\s+you\s+requested\b/i,
  /\basked\s+me\s+to\s+pick\s+you\s+up\b/i,
  /\basked\s+me\s+to\s+walk\s+with\s+you\b/i,
  /\bour\s+agreed\s+meeting\b/i,
  /\bappointment\s+you\s+scheduled\b/i,
  /\bas\s+we\s+agreed\b/i
];

const BENIGN_SAFETY_CONTEXT = [
  /(?:i will\s+)?shoot\s+you\s+the\s+updated\s+spreadsheet/i,
  /(?:i will\s+)?shoot\s+you\s+the\s+(?:(?:updated|revised|final|latest)\s+)?(?:spreadsheet|presentation|file|document|report|draft|version|photo|link|message|email)\b/i,
  /point\s+(?:the\s+)?knife\s+away/i,
  /mario\s+kart/i,
  /in\s+the\s+movie/i,
  /during\s+rehearsal/i,
  /rehearsal\s+line/i,
  /sun\s+exposure/i,
  /workout\s+metaphor/i,
  /safety\s+instruction/i,
  /medical\s+harm/i,
  /could\s+harm\s+your\s+skin/i
];

// Full-clause contexts for quotations, safety guidance, metaphors, and clearly
// consensual logistics. These are deliberately specific so a nearby real
// first-person threat in a separate clause or message remains eligible.
const BENIGN_FULL_CLAUSE_CONTEXT = [
  /\bnovel\s+includes\s+the\s+line\b[^.!?]{0,100}\bcritic\b[^.!?]{0,60}\bdialogue\b/i,
  /\bactor\s+rehearsed\b[^.!?]{0,100}\bdirector\s+replaced\s+the\s+violent\s+line\b/i,
  /\bpodcast\s+quoted\s+a\s+threat\b[^.!?]{0,100}\bseek\s+support\b/i,
  /\bnews\s+anchor\s+reported\b[^.!?]{0,100}\bsuspect\s+wrote\b[^.!?]{0,100}\btrial\b/i,
  /\bgame\s+character\s+shouted\b[^.!?]{0,100}\bmatch\s+started\b/i,
  /\bdocumentary\s+reenacted\s+the\s+message\b[^.!?]{0,100}\bstalking\s+evidence\b/i,
  /\bteacher\s+wrote\b[^.!?]{0,100}\bon\s+the\s+board\b[^.!?]{0,100}\bexample\s+of\s+threatening\s+language\b/i,
  /\bcounselor\s+quoted\b[^.!?]{0,100}\bexplaining\s+coercive\s+self-harm\s+threats\b/i,
  /\bprosecutor\s+read\b[^.!?]{0,100}\bpresenting\s+the\s+authenticated\s+evidence\b/i,
  /\bmy\s+friend\s+texted\b[^.!?]{0,100}\bterrible\s+joke\b/i,
  /\b(?:video\s+game|movie|novel|script)\b[^.!?]{0,100}\b(?:villain|character|actor)\b[^.!?]{0,100}\b(?:says|said|shouted|line)\b/i,
  /\bspicy\s+chili\b[^.!?]{0,100}\b(?:serving|water)\b/i,
  /\bmurder\s+on\s+your\s+feet\b/i,
  /\bkiller\s+workout\b/i,
  /\bdestroy\s+you\s+at\s+(?:chess|cards|mario\s+kart)\b/i,
  /\byou\s+are\s+dead\s+wrong\b/i,
  /\bdeadline\s+will\s+kill\s+me\s+figuratively\b/i,
  /\bmountain\s+climb\s+will\s+murder\s+your\s+legs\b/i,
  /\b(?:infection|carbon\s+monoxide|midday\s+sun|strong\s+river|electric\s+current)\b[^.!?]{0,120}\b(?:doctor|detector|sunscreen|life\s+jacket|disconnect\s+power|medical\s+care)\b/i,
  /\bdoctor\s+said\s+the\s+medicine\b[^.!?]{0,120}\b(?:alcohol|drug)\b/i,
  /\bpoint\s+the\s+knife\s+away\s+from\s+(?:yourself|you)\b/i,
  /\bnever\s+point\s+the\s+firearm\s+at\s+anyone\b[^.!?]{0,100}\btraining\b/i,
  /\bsafety\s+(?:instructor|guide)\b[^.!?]{0,120}\b(?:disconnect\s+power|cutting\s+board|safe)\b/i,
  /\bduring\s+rehearsal\b[^.!?]{0,120}\bstage\s+manager\b[^.!?]{0,80}\bchoreography\b/i,
  /\bescape-room\s+host\b[^.!?]{0,120}\bemergency\s+exits\s+remain\s+available\b/i,
  /\blocksmith\s+explained\b[^.!?]{0,120}\bdamaged\s+latch\s+is\s+repaired\b/i,
  /\btook\s+your\s+keys\s+to\s+the\s+mechanic\b[^.!?]{0,100}\byou\s+asked\s+me\b/i,
  /\binstalled\s+a\s+tracker\s+in\s+my\s+own\s+luggage\b/i,
  /\bfleet\s+manager\b[^.!?]{0,100}\bcompany\s+car\b[^.!?]{0,100}\bsigned\s+the\s+written\s+vehicle\s+policy\b/i,
  /\bknow\s+your\s+work\s+schedule\b[^.!?]{0,100}\byou\s+asked\s+me\s+to\s+arrange\s+carpools\b/i,
  /\boutside\s+your\s+house\b[^.!?]{0,100}\bgroceries\s+you\s+requested\b/i,
  /\bfind\s+you\s+a\s+new\s+apartment\b/i,
  /\bfollowing\s+you\s+home\b[^.!?]{0,100}\bbicycle\s+light\b[^.!?]{0,100}\bas\s+we\s+agreed\b/i,
  /\bend\s+the\s+recording\b[^.!?]{0,100}\bedited\s+file\b/i,
  /\ball\s+the\s+pills\s+ready\s+in\s+the\s+weekly\s+organizer\b/i,
  /\bshoot\s+you\s+the\s+revised\s+presentation\b/i
];

const CLAUSE_SPLIT_RE = /\s*;\s*|\s*,\s+and\s+|\s+\bbut\s+|\s+\bhowever\s+|\s+\byet\s+/gi;

const THIRD_PARTY_ATTRIBUTION =
  /(?:character|villain|actor|suspect|defendant|attacker|witness|police|they|he|she|someone|instructor|trainer|teacher|facilitator|coach)\s+said\b/i;

const REPORTED_QUOTE_ATTRIBUTION =
  /(?:article|report|news|story|headline)\s+(?:said|reported|quoted|described)\b/i;

const INSTRUCTIONAL_ATTRIBUTION =
  /(?:instructor|trainer|teacher|facilitator|coach)\s+(?:used|quoted|said|showed|gave|described)\b/i;

const TRAINING_SEGMENT =
  /(?:safety|workplace|de-?escalation|crisis\s+line)\s+training|training\s+example|fictional\s+(?:scene|dialogue|example)|in\s+a\s+(?:movie|book|script|novel)/i;

const TRAINING_EXAMPLE_PHRASE =
  /as\s+an\s+example|example\s+of\s+(?:threatening|stalking)\s+language|stalking\s+behavior|training\s+scenario|fictional\s+training|to\s+demonstrate\s+(?:threatening|stalking)\s+language|used\s+to\s+demonstrate|demonstrate\s+(?:threatening|stalking)\s+language/i;

const MEDICAL_CONTEXT = /\b(?:doctor|treatment|medication|procedure|therapy)\b/i;

const NEGATION_WORD =
  '(?:never|not|no|cannot|can\'t|won\'t|would\\s+never|do\\s+not|don\'t|does\\s+not|doesn\'t|should\\s+not|shouldn\'t|wouldn\'t)';

function normalizeForSafety(text) {
  return normalizeForMatching(text);
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

function findRuleMatches(text, rules) {
  const matches = [];

  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      matches.push({
        id: rule.id || 'stalking',
        severe: rule.severe || false,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

function findStalkingBehaviors(text) {
  return findRuleMatches(text, STALKING_BEHAVIORS);
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

function isThirdPartyQuote(clauseText, matchStart, matchText) {
  if (isFirstPersonThreatMatch(clauseText, matchStart, matchText)) return false;

  const before = clauseText.slice(0, matchStart);
  const recent = before.slice(-120);
  const attributionMatch = recent.match(
    /(?:character|villain|actor|suspect|defendant|attacker|witness|police|they|he|she|someone|instructor|trainer|teacher|facilitator|coach)\s+said\b([\s\S]*)$/i
  );
  if (attributionMatch && /["']/.test(attributionMatch[1])) return true;
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

function isAttributedClause(clauseText, matchStart, matchText = '') {
  if (isThirdPartyQuote(clauseText, matchStart, matchText)) return true;
  if (isInstructionalQuote(clauseText, matchStart)) return true;
  if (isTrainingOnlyClause(clauseText)) return true;
  return false;
}

function isMedicalReassurance(clauseText, matchStart, matchText) {
  const before = clauseText.slice(Math.max(0, matchStart - 80), matchStart);
  if (!MEDICAL_CONTEXT.test(before)) return false;
  return /\bshould\s+not\s+harm\b/i.test(
    clauseText.slice(Math.max(0, matchStart - 20), matchStart + matchText.length)
  );
}

function hasMenace(text) {
  return MENACE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBenignConsent(text) {
  return BENIGN_CONSENT_PATTERNS.some((pattern) => pattern.test(text));
}

function isNegatedBenignPhrase(clauseText, phraseStart) {
  const window = clauseText.slice(Math.max(0, phraseStart - 50), phraseStart);
  return (
    /\b(?:not|no|never)\s+(?:a\s+)?$/i.test(window.slice(-22)) ||
    /\b(?:is\s+not|are\s+not|this\s+is\s+not|we're\s+not|we\s+are\s+not)\s+(?:a\s+)?$/i.test(
      window.slice(-35)
    )
  );
}

function isFirstPersonThreatMatch(clauseText, matchStart, matchText) {
  const local = clauseText.slice(matchStart, matchStart + matchText.length);
  if (/\b(?:i\s+will|i'll|i'?ll)\b/i.test(local)) return true;
  if (/\b(?:i'?m|i am)\s+going\s+to\b/i.test(local)) return true;
  const window = clauseText.slice(Math.max(0, matchStart - 8), matchStart + matchText.length);
  return /\b(?:i\s+will|i'll|i'?ll|i'?m|i am)\s+(?:going\s+to\s+)?(?:kill|hurt|harm|shoot|stab|murder)\b/i.test(
    window
  );
}

function isBenignSafetyContextForMatch(clauseText, match) {
  if (BENIGN_FULL_CLAUSE_CONTEXT.some((pattern) => pattern.test(clauseText))) return true;

  if (/point\s+(?:the\s+)?knife\s+away/i.test(clauseText)) return true;

  if (
    /during\s+rehearsal/i.test(clauseText) &&
    /\bactor\s+said\b/i.test(clauseText) &&
    /\bon\s+cue\b/i.test(clauseText)
  ) {
    return true;
  }

  if (
    /\bin\s+the\s+movie\b/i.test(clauseText) &&
    /\b(?:villain|character)\s+said\b/i.test(clauseText) &&
    isFirstPersonThreatMatch(clauseText, match.start, match.text)
  ) {
    return true;
  }

  for (const pattern of BENIGN_SAFETY_CONTEXT) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let phraseMatch;
    while ((phraseMatch = re.exec(clauseText)) !== null) {
      if (isNegatedBenignPhrase(clauseText, phraseMatch.index)) continue;

      const phraseStart = phraseMatch.index;
      const phraseEnd = phraseMatch.index + phraseMatch[0].length;

      if (match.start >= phraseStart && match.end <= phraseEnd) return true;
      if (
        phraseStart === match.start &&
        phraseEnd > match.end &&
        /(?:shoot|stab)\s+you\s+the\b/i.test(phraseMatch[0])
      ) {
        return true;
      }
    }
  }
  return false;
}

function isExcludedImmediateCandidate(clauseText, match) {
  if (isBenignSafetyContextForMatch(clauseText, match)) return true;
  if (isNegatedForCandidate(clauseText, match.start, match.text)) return true;
  if (isAttributedClause(clauseText, match.start)) return true;
  if (isMedicalReassurance(clauseText, match.start, match.text)) return true;
  return false;
}

function getExpandedContext(sentences, index) {
  const parts = [];
  if (sentences[index - 1]) parts.push(sentences[index - 1].text);
  parts.push(sentences[index].text);
  if (sentences[index + 1]) parts.push(sentences[index + 1].text);
  return parts.join(' ');
}

function makeStalkingResult(normalized, globalStart, globalEnd) {
  return {
    ...SAFETY_NOTICE,
    category: 'stalking',
    evidenceSpan: {
      start: globalStart,
      end: globalEnd,
      text: normalized.slice(globalStart, globalEnd)
    }
  };
}

function clauseForBehavior(sentenceText, behaviorStart) {
  const clauses = splitClauses(sentenceText);
  const clause =
    clauses.find((entry) => behaviorStart >= entry.start && behaviorStart < entry.end) ||
    clauses[0];
  if (!clause) return { text: sentenceText, start: 0 };
  return clause;
}

function filterEligibleBehaviors(sentenceText, behaviors) {
  return behaviors.filter((behavior) => {
    const clause = clauseForBehavior(sentenceText, behavior.start);
    const localStart = behavior.start - clause.start;
    return !isAttributedClause(clause.text, localStart, behavior.text);
  });
}

function firstPersonStalkingContext(sentenceText, behavior) {
  const clause = clauseForBehavior(sentenceText, behavior.start);
  const localStart = behavior.start - clause.start;
  const prefix = clause.text.slice(0, localStart);
  return prefix + behavior.text;
}

function isExplicitFutureFirstPersonStalking(sentenceText, behavior) {
  return /\b(?:i\s+really\s+will|i\s+will|i'?ll|i\s+am\s+going\s+to|i'?m\s+going\s+to)\b/i.test(
    firstPersonStalkingContext(sentenceText, behavior)
  );
}

function isContinuousAdverbFirstPersonStalking(sentenceText, behavior) {
  return /\b(?:i\s+am|i'?m)\s+(?:actually|still|currently)\s+(?:waiting|following)/i.test(
    firstPersonStalkingContext(sentenceText, behavior)
  );
}

function collectExpandedEligibleBehaviors(sentences, centerIndex) {
  const eligible = [];

  for (let offset = -1; offset <= 1; offset += 1) {
    const idx = centerIndex + offset;
    if (idx < 0 || idx >= sentences.length) continue;

    const sentence = sentences[idx];
    const behaviors = findStalkingBehaviors(sentence.text);
    const eligibleInSentence = filterEligibleBehaviors(sentence.text, behaviors);

    for (const behavior of eligibleInSentence) {
      eligible.push({
        ...behavior,
        sentenceIndex: idx,
        globalStart: sentence.start + behavior.start,
        globalEnd: sentence.start + behavior.end,
        sentenceText: sentence.text
      });
    }
  }

  return eligible;
}

function detectContextualStalking(sentences, normalized) {
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const expanded = getExpandedContext(sentences, i);
    const menace = hasMenace(expanded);
    const eligibleBehaviors = filterEligibleBehaviors(
      sentence.text,
      findStalkingBehaviors(sentence.text)
    );
    const eligibleExpanded = collectExpandedEligibleBehaviors(sentences, i);
    const benignInSentence = hasBenignConsent(sentence.text);

    for (const behavior of eligibleBehaviors) {
      if (behavior.severe) {
        return makeStalkingResult(
          normalized,
          sentence.start + behavior.start,
          sentence.start + behavior.end
        );
      }
    }

    if (eligibleBehaviors.length === 0) continue;

    if (benignInSentence && !menace) continue;

    if (
      !benignInSentence &&
      eligibleBehaviors.some((behavior) =>
        isExplicitFutureFirstPersonStalking(sentence.text, behavior)
      )
    ) {
      const behavior = eligibleBehaviors.find((entry) =>
        isExplicitFutureFirstPersonStalking(sentence.text, entry)
      );
      return makeStalkingResult(
        normalized,
        sentence.start + behavior.start,
        sentence.start + behavior.end
      );
    }

    if (
      !benignInSentence &&
      menace &&
      eligibleBehaviors.some((behavior) =>
        isContinuousAdverbFirstPersonStalking(sentence.text, behavior)
      )
    ) {
      const behavior = eligibleBehaviors.find((entry) =>
        isContinuousAdverbFirstPersonStalking(sentence.text, entry)
      );
      return makeStalkingResult(
        normalized,
        sentence.start + behavior.start,
        sentence.start + behavior.end
      );
    }

    if (menace) {
      const behavior = eligibleBehaviors[0];
      return makeStalkingResult(
        normalized,
        sentence.start + behavior.start,
        sentence.start + behavior.end
      );
    }

    const intrusive = eligibleExpanded.filter(
      (behavior) => !/know\s+where\s+you\s+(?:live|work)/i.test(behavior.text)
    );
    if (intrusive.length >= 2) {
      const behavior = intrusive[0];
      return makeStalkingResult(normalized, behavior.globalStart, behavior.globalEnd);
    }

    const eligibleExpandedText = eligibleExpanded.map((b) => b.sentenceText).join(' ');

    if (
      /know\s+where\s+you\s+work/i.test(eligibleExpandedText) &&
      /(?:watching|following|waiting|outside|cannot\s+hide)/i.test(eligibleExpandedText)
    ) {
      const behavior = eligibleBehaviors[0];
      return makeStalkingResult(
        normalized,
        sentence.start + behavior.start,
        sentence.start + behavior.end
      );
    }

    if (
      /know\s+where\s+you\s+live/i.test(eligibleExpandedText) &&
      /(?:watching|find\s+you|come\s+find)/i.test(eligibleExpandedText) &&
      menace
    ) {
      const behavior = eligibleBehaviors[0];
      return makeStalkingResult(
        normalized,
        sentence.start + behavior.start,
        sentence.start + behavior.end
      );
    }
  }

  return null;
}

function detectSafetyInBlock(blockText, blockOffset, fullNormalized) {
  const normalized = normalizeForMatching(blockText);
  if (!normalized) return null;

  const sentences = splitSentences(normalized);

  for (const sentence of sentences) {
    const clauses = splitClauses(sentence.text);

    for (const clause of clauses) {
      const candidates = findRuleMatches(clause.text, IMMEDIATE_RULES);

      for (const candidate of candidates) {
        if (isExcludedImmediateCandidate(clause.text, candidate)) continue;

        const localStart = sentence.start + clause.start + candidate.start;
        const localEnd = sentence.start + clause.start + candidate.end;
        const globalStart = blockOffset + localStart;
        const globalEnd = blockOffset + localEnd;

        return {
          ...SAFETY_NOTICE,
          category: candidate.id,
          evidenceSpan: {
            start: globalStart,
            end: globalEnd,
            text: fullNormalized.slice(globalStart, globalEnd)
          }
        };
      }
    }
  }

  const stalking = detectContextualStalking(sentences, normalized);
  if (!stalking) return null;

  if (stalking.evidenceSpan) {
    const localStart = stalking.evidenceSpan.start;
    const localEnd = stalking.evidenceSpan.end;
    return {
      ...stalking,
      evidenceSpan: {
        start: blockOffset + localStart,
        end: blockOffset + localEnd,
        text: fullNormalized.slice(blockOffset + localStart, blockOffset + localEnd)
      }
    };
  }

  return stalking;
}

/**
 * @returns {typeof SAFETY_NOTICE & { category?: string, evidenceSpan?: { start: number, end: number, text: string } } | null}
 */
export function detectSafetyNotice(text) {
  const normalized = normalizeAnalysisText(text);
  if (!normalized) return null;

  const blocks = splitMessageBlocks(normalized);
  for (const block of blocks) {
    const notice = detectSafetyInBlock(block.text, block.start, normalized);
    if (notice) return notice;
  }

  return null;
}
