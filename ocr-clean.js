/**
 * Post-OCR cleanup for chat/screenshot images.
 * Scores each line, drops chrome aggressively, and reconstructs message text.
 */

const KEEP_SCORE = 12;

const DROP_LINE_PATTERNS = [
  /^(delivered|read|sent|sending|failed|not delivered|edited|unsent)$/i,
  /^(encrypted|end-to-end encrypted|end-to-end)$/i,
  /^(iMessage|SMS|MMS|RCS|Message|Messages|Text Message)$/i,
  /^(show in calendar|add to calendar|show in maps)$/i,
  /^add$/i,
  /^(reply|forward|copy|delete|undo|redo|edit|done|cancel|ok|close|back|next|share|save)$/i,
  /^(photo|video|audio|gif|sticker|attachment|tap to download|slide to reply)$/i,
  /^(today|yesterday|new message|new messages|typing\.{0,3})$/i,
  /^(search|notifications?|settings?|menu|more|options)$/i,
  /^(lte|5g|4g|3g|wi-?fi|wifi|vpn|sos|nfc)$/i,
  /^(am|pm)$/i,
  /^(\d{1,2}:\d{2}(\s*[ap]m)?)$/i,
  /^(\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i,
  /^(mon|tue|wed|thu|fri|sat|sun)(day)?$/i,
  /^(\d{1,3})%$/,
  /^[•·|_=\-–—~`^*\\/@#]+$/,
  /^[^\w\s]{1,12}$/u,
  /^(camera|photos?|gallery|contacts?)$/i,
  /^(missed call|facetime|call|voicemail)$/i,
  /^(location|maps?|calendar|reminders?)$/i,
  /^(delivered quietly|read receipts?)$/i,
  /^(sent with (slo-mo|invisible ink|digital touch|handwritten))$/i,
  /^(liked|loved|emphasized|questioned|disliked|laughed at|removed a heart from)$/i,
  /^[A-Za-z]$/
];

const DROP_LINE_CONTAINS = [
  /\bshow in calendar\b/i,
  /\badd to calendar\b/i,
  /\btap to (download|load|view)\b/i,
  /\bslide to reply\b/i,
  /\bmessage effects?\b/i,
  /\bkeep in chat\b/i,
  /\bnot delivered\b/i,
  /\bend-to-end\b/i,
  /\btext message\b/i,
  /\bwith (slo-mo|invisible ink)\b/i
];

const HEADER_PHONE_PATTERN = /^\+?[\d\s().\-]{10,}$/;

const COMMON_SHORT_MESSAGES = new Set([
  'hi', 'hey', 'ok', 'okay', 'yes', 'no', 'why', 'help', 'stop', 'wait', 'please',
  'thanks', 'sorry', 'what', 'when', 'where', 'really', 'fine', 'sure', 'never', 'always'
]);

function normalizeWhitespace(text) {
  return text
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function letterRatio(line) {
  const letters = (line.match(/[a-zA-Z]/g) || []).length;
  const meaningful = line.replace(/\s/g, '').length;
  return meaningful > 0 ? letters / meaningful : 0;
}

function wordTokens(line) {
  return line.match(/[a-zA-Z]{2,}/g) || [];
}

function wordCount(line) {
  return wordTokens(line).length;
}

function looksLikeHeaderPhone(line) {
  const compact = line.replace(/\s/g, '');
  if (!HEADER_PHONE_PATTERN.test(line.trim())) return false;
  return compact.replace(/\D/g, '').length >= 10;
}

function looksLikeStatusBarFragment(line) {
  const trimmed = line.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) return true;
  if (/^(\d{1,2}:\d{2}\s*[AP]M)$/i.test(trimmed)) return true;
  if (/^(carrier|verizon|at&t|t-mobile|sprint)$/i.test(trimmed)) return true;
  return false;
}

function looksLikeStatusBarMixed(line) {
  if (!/\d{1,2}:\d{2}/.test(line)) return false;

  const withoutTime = line.replace(/\d{1,2}:\d{2}(\s*[ap]m)?/gi, ' ').trim();
  const words = wordCount(withoutTime);
  const letters = (withoutTime.match(/[a-zA-Z]/g) || []).length;

  if (words === 0) return true;
  if (words <= 2 && letters <= 10) return true;
  if (line.length < 50 && words <= 3 && letterRatio(withoutTime) < 0.55) return true;

  return false;
}

function looksLikeTimestampAnnotation(line) {
  const trimmed = line.trim();
  if (/^(today|yesterday)(\s+at)?\s+\d{1,2}:\d{2}/i.test(trimmed)) return true;
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}:\d{2}/i.test(trimmed)) return true;
  if (/^(at\s+)?\d{1,2}:\d{2}\s*(am|pm)$/i.test(trimmed)) return true;
  if (/^\d{1,2}:\d{2}\s*(am|pm)\s*$/i.test(trimmed)) return true;
  return false;
}

function looksLikeAtPrefixUi(line) {
  const trimmed = line.trim();
  if (!/^@/.test(trimmed)) return false;
  const body = trimmed.replace(/^@\s*/, '');
  if (/^(encrypted|delivered|read|sent)$/i.test(body)) return true;
  if (wordCount(body) <= 2 && trimmed.length < 40) return true;
  return false;
}

function looksLikeContactNameChrome(line, index) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 32) return false;

  const lower = trimmed.toLowerCase();
  if (COMMON_SHORT_MESSAGES.has(lower)) return false;

  if (/^[A-Za-z][a-z]+(?:'[a-z]+)?[)>\]]+$/.test(trimmed)) return true;
  if (/^[A-Za-z][a-z]+(?:'[a-z]+)?\)?$/.test(trimmed) && trimmed.length < 18) return true;
  if (/^\d+\s+[A-Za-z][a-z]+(?:'[a-z]+)?(\s+[^\s]{1,4})?$/.test(trimmed)) return true;

  const words = trimmed.split(/\s+/);
  if (words.length <= 2 && trimmed.length < 24) {
    const titleCaseName = words.every(
      (word) => /^[A-Z][a-z]+(?:'[a-z]+)?$/.test(word) || /^[A-Z]{2,}$/.test(word)
    );
    if (titleCaseName && index < 10) return true;
    if (titleCaseName && words.length === 1 && trimmed.length < 16) return true;
  }

  return false;
}

function looksLikeGarbled(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 2 && !/[a-zA-Z]{2}/.test(trimmed)) return true;

  const ratio = letterRatio(trimmed);
  const words = wordCount(trimmed);

  if (trimmed.length >= 3 && ratio < 0.15 && words === 0) return true;
  if (trimmed.length >= 6 && ratio < 0.28 && words === 0) return true;
  if (trimmed.length >= 8 && ratio < 0.38 && words <= 1) return true;

  const weird = (trimmed.match(/[^\w\s.,!?'"\-—…:;()]/gu) || []).length;
  if (trimmed.length >= 5 && weird / trimmed.length > 0.32 && words <= 1) return true;
  if (trimmed.length >= 10 && weird / trimmed.length > 0.38 && words <= 2) return true;

  const caps = (trimmed.match(/[A-Z]/g) || []).length;
  const lower = (trimmed.match(/[a-z]/g) || []).length;
  if (words <= 2 && caps > 0 && lower > 0 && trimmed.length < 30) return true;

  const digits = (trimmed.match(/\d/g) || []).length;
  if (digits > 0 && digits / trimmed.length > 0.35 && words <= 2) return true;

  return false;
}

function hardDropLine(line, index, allLines) {
  const trimmed = line.trim();
  if (!trimmed) return true;

  for (const pattern of DROP_LINE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  for (const pattern of DROP_LINE_CONTAINS) {
    if (pattern.test(trimmed)) return true;
  }

  if (looksLikeStatusBarFragment(trimmed)) return true;
  if (looksLikeStatusBarMixed(trimmed)) return true;
  if (looksLikeTimestampAnnotation(trimmed)) return true;
  if (looksLikeAtPrefixUi(trimmed)) return true;
  if (looksLikeContactNameChrome(trimmed, index)) return true;
  if (looksLikeHeaderPhone(trimmed)) return true;
  if (looksLikeGarbled(trimmed)) return true;
  if (/\bencrypted\b/i.test(trimmed) && wordCount(trimmed) <= 2) return true;
  if (index > 0 && trimmed === allLines[index - 1]?.trim()) return true;

  return false;
}

function scoreLineAsMessage(line, index, allLines) {
  const trimmed = line.trim();
  if (!trimmed || hardDropLine(trimmed, index, allLines)) return -999;

  let score = 0;
  const words = wordTokens(trimmed);
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const len = trimmed.length;
  const ratio = letterRatio(trimmed);

  score += words.length * 4;
  score += Math.min(len / 7, 12);
  if (/[.!?…]/.test(trimmed)) score += 7;
  if (ratio >= 0.7) score += 6;
  else if (ratio >= 0.55) score += 3;
  if (words.length >= 5) score += 8;
  if (words.length >= 3 && len >= 24) score += 5;
  if (len >= 50) score += 4;

  const lower = trimmed.toLowerCase();
  if (COMMON_SHORT_MESSAGES.has(lower)) score += 16;
  if (words.length === 2 && len >= 10 && /[a-z]/.test(trimmed)) score += 10;

  if (words.length <= 1 && len < 18) score -= 8;
  if (ratio < 0.45 && words.length <= 2) score -= 10;

  return score;
}

function sanitizeMessageLine(line) {
  let text = line.trim();
  text = text.replace(/^[@#•·|_=\-–—~`^\\*]+/, '');
  text = text.replace(/[@#•·|\\]+/g, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

function shouldMergeWithPrevious(previous, next) {
  if (!previous || !next) return false;
  if (/[.!?…]$/.test(previous)) return false;
  if (previous.length > 90) return false;

  const prevWords = wordCount(previous);
  const nextWords = wordCount(next);

  if (/^[a-z('"‘]/.test(next)) return true;
  if (nextWords >= 1 && prevWords < 8 && next.length < 70) return true;
  if (!/[.!?…]$/.test(previous) && nextWords <= 5 && next.length < 55) return true;

  return false;
}

function reconstructMessageText(lines) {
  const merged = [];

  for (const rawLine of lines) {
    const line = sanitizeMessageLine(rawLine);
    if (!line) continue;

    if (merged.length && shouldMergeWithPrevious(merged[merged.length - 1], line)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
    } else {
      merged.push(line);
    }
  }

  return merged.join('\n');
}

function looksLikeMessageLine(line) {
  return scoreLineAsMessage(line, 0, [line]) >= KEEP_SCORE;
}

function countMessageLikeLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && looksLikeMessageLine(line)).length;
}

/**
 * Score cleaned extraction quality for user messaging.
 * @returns {'good' | 'fair' | 'poor' | 'empty'}
 */
export function assessExtractionQuality(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'empty';

  const words = trimmed.match(/\b[a-zA-Z]{3,}\b/g) || [];
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const noise = (trimmed.match(/[^\w\s.,!?'"\-—…]/gu) || []).length;
  const noiseRatio = trimmed.length > 0 ? noise / trimmed.length : 1;
  const messageLines = countMessageLikeLines(trimmed);

  if (messageLines === 0 || words.length < 3 || letters < 15) return 'poor';
  if (messageLines < 2 && words.length < 5) return 'poor';
  if (words.length < 5 || letters < 28 || noiseRatio > 0.2) return 'fair';
  return 'good';
}

/**
 * Clean OCR output from chat screenshots.
 * @returns {{ text: string, quality: 'good' | 'fair' | 'poor' | 'empty' }}
 */
export function cleanScreenshotText(raw) {
  if (!raw || !raw.trim()) {
    return { text: '', quality: 'empty' };
  }

  const normalized = normalizeWhitespace(raw);
  const rawLines = normalized.split('\n');
  const scored = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    const score = scoreLineAsMessage(line, i, rawLines);
    if (score >= KEEP_SCORE) {
      scored.push({ line, score, index: i });
    }
  }

  // If nothing clears threshold, keep only the strongest line if it looks like a message
  if (!scored.length) {
    let best = { line: '', score: -999, index: -1 };
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;
      const score = scoreLineAsMessage(line, i, rawLines);
      if (score > best.score) best = { line, score, index: i };
    }
    if (best.score >= 8) scored.push(best);
  }

  scored.sort((a, b) => a.index - b.index);
  let text = normalizeWhitespace(reconstructMessageText(scored.map((item) => item.line)));
  let quality = assessExtractionQuality(text);

  if (quality === 'poor' && countMessageLikeLines(text) < 1) {
    text = '';
    quality = 'empty';
  }

  return { text, quality };
}
