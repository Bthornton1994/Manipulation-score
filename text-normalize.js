const SMART_APOSTROPHE = /[\u2018\u2019\u02BC\u0060\u201B]/g;
const SMART_QUOTE = /[\u201C\u201D\u201E\u2033\u2036]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const FORMAT_CHARS = /[\u200B-\u200D\uFEFF]/g;

/**
 * Normalize text for scoring and safety matching while preserving paragraph breaks.
 */
export function normalizeAnalysisText(text) {
  return (text || '')
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
