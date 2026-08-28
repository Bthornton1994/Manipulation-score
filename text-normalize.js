const SMART_APOSTROPHE = /[\u2018\u2019\u02BC\u0060\u201B]/g;
const SMART_QUOTE = /[\u201C\u201D\u201E\u2033\u2036]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const FORMAT_CHARS = /[\u200B-\u200D\uFEFF]/g;
/** Em/en and other unicode dashes — treat as token separators (not ASCII `-`). */
const UNICODE_DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * Normalize text for scoring and safety matching while preserving paragraph breaks.
 */
export function normalizeAnalysisText(text) {
  return (text || '')
    // Before NFKC so fullwidth/small dashes are not folded to ASCII `-`.
    .replace(UNICODE_DASHES, ' ')
    .normalize('NFKC')
    .replace(FORMAT_CHARS, '')
    .replace(/\u00AD/g, '')
    .replace(SMART_APOSTROPHE, "'")
    .replace(SMART_QUOTE, '"')
    .replace(UNICODE_SPACES, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeForMatching(text) {
  return normalizeAnalysisText(text).replace(/\n+/g, ' ');
}

/**
 * Split on blank lines into blocks with start offsets in the normalized string.
 */
export function splitMessageBlocks(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return [{ text: trimmed, start: 0, end: trimmed.length }];
  }

  const blocks = [];
  let searchFrom = 0;
  for (const part of parts) {
    const start = trimmed.indexOf(part, searchFrom);
    const safeStart = start === -1 ? trimmed.indexOf(part) : start;
    const end = safeStart + part.length;
    blocks.push({ text: part, start: safeStart, end });
    searchFrom = end;
  }
  return blocks;
}

const NON_LATIN_LETTER = /\p{Script=Latin}/u;
const NON_ENGLISH_MARKERS =
  /\b(?:dejarás|contraseña|familia|realmente|amas|ahora|mismo|preguntar|también|usted|ustedes|pour|avec|vous|nicht|und|ihr|dein|mon|ton|nous|très|être|avoir)\b/i;

/**
 * Returns true when the text is likely outside supported English screening.
 */
const CLAUSE_SPLIT_RE = /\s*;\s*|\s*,\s+and\s+|\s+\bbut\s+|\s+\bhowever\s+|\s+\byet\s+/gi;

export function splitSentences(text) {
  const segments = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lead = raw.indexOf(trimmed);
    const start = match.index + lead;
    segments.push({ text: trimmed, start, end: start + trimmed.length });
  }
  if (!segments.length && text) {
    segments.push({ text, start: 0, end: text.length });
  }
  return segments;
}

export function splitClauses(segmentText) {
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

/** Clause that contains an offset in the full (possibly multi-sentence) text. */
export function findClauseAt(text, offsetStart) {
  const sentences = splitSentences(text);
  const sentence =
    sentences.find((s) => offsetStart >= s.start && offsetStart < s.end) ||
    sentences[sentences.length - 1] ||
    { text, start: 0, end: text.length };
  const relative = Math.max(0, offsetStart - sentence.start);
  const clauses = splitClauses(sentence.text);
  const clause =
    clauses.find((c) => relative >= c.start && relative < c.end) || clauses[0];
  if (!clause) {
    return { text: sentence.text, start: sentence.start, end: sentence.end };
  }
  return {
    text: clause.text,
    start: sentence.start + clause.start,
    end: sentence.start + clause.end
  };
}

export function isLikelyUnsupportedLanguage(text) {
  if (NON_ENGLISH_MARKERS.test(text)) return true;

  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 8) return false;

  let latin = 0;
  for (const letter of letters) {
    if (NON_LATIN_LETTER.test(letter)) latin += 1;
  }

  if (latin / letters.length < 0.8) return true;

  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text)) return true;

  return false;
}
