/**
 * Post-OCR cleanup for chat/screenshot images.
 * Strips common UI chrome and keeps conversation-like content.
 */

const DROP_LINE_PATTERNS = [
  /^(delivered|read|sent|sending|failed|not delivered|edited|unsent)$/i,
  /^(iMessage|SMS|MMS|RCS|Message|Messages|Text Message)$/i,
  /^(show in calendar|add to calendar|show in maps)$/i,
  /^add$/i,
  /^(reply|forward|copy|delete|undo|redo|edit|done|cancel|ok|close|back|next|share|save)$/i,
  /^(photo|video|audio|gif|sticker|attachment|tap to download|slide to reply)$/i,
  /^(today|yesterday|new message|new messages|typing\.{0,3})$/i,
  /^(search|notifications?|settings?|menu|more|options)$/i,
  /^(lte|5g|4g|3g|wi-?fi|wifi|vpn|sos)$/i,
  /^(am|pm)$/i,
  /^(\d{1,2}:\d{2}(\s*[ap]m)?|\d{1,2}:\d{2})$/i,
  /^(\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i,
  /^(mon|tue|wed|thu|fri|sat|sun)(day)?$/i,
  /^(\d{1,3})%$/,
  /^[•·|_=\-–—~`^*]+$/,
  /^[^\w\s]{1,8}$/u,
  /^(camera|photos?|gallery|contacts?)$/i,
  /^(missed call|facetime|call|voicemail)$/i,
  /^(location|maps?|calendar|reminders?)$/i,
  /^(delivered quietly|read receipts?)$/i,
  /^(sent with (slo-mo|invisible ink|digital touch|handwritten))$/i
];

const DROP_LINE_CONTAINS = [
  /\bshow in calendar\b/i,
  /\badd to calendar\b/i,
  /\btap to (download|load|view)\b/i,
  /\bslide to reply\b/i,
  /\bmessage effects?\b/i,
  /\bkeep in chat\b/i,
  /\bnot delivered\b/i
];

const HEADER_PHONE_PATTERN = /^\+?[\d\s().\-]{10,}$/;

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

function wordCount(line) {
  return (line.match(/[a-zA-Z]{2,}/g) || []).length;
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

function looksLikeGarbled(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 2 && !/[a-zA-Z]{2}/.test(trimmed)) return true;

  const ratio = letterRatio(trimmed);
  const words = wordCount(trimmed);

  if (trimmed.length >= 4 && ratio < 0.2 && words === 0) return true;
  if (trimmed.length >= 8 && ratio < 0.35 && words <= 1) return true;

  const weird = (trimmed.match(/[^\w\s.,!?'"\-—…:;()@#]/gu) || []).length;
  if (trimmed.length >= 6 && weird / trimmed.length > 0.45 && words <= 1) return true;

  return false;
}

function looksLikeContactHeader(line, index) {
  if (index > 4) return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 28) return false;
  if (/[.!??,]/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  const commonMessages = new Set(['hi', 'hey', 'ok', 'okay', 'yes', 'no', 'why', 'help', 'stop', 'wait', 'please']);
  if (commonMessages.has(lower)) return false;

  const words = trimmed.split(/\s+/);
  if (words.length > 3) return false;

  return words.every((word) => /^[A-Z][a-z]+(?:'[a-z]+)?$/.test(word) || /^[A-Z]{2,}$/.test(word));
}

function shouldDropLine(line, index, allLines) {
  const trimmed = line.trim();
  if (!trimmed) return true;

  for (const pattern of DROP_LINE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  for (const pattern of DROP_LINE_CONTAINS) {
    if (pattern.test(trimmed)) return true;
  }

  if (looksLikeStatusBarFragment(trimmed)) return true;
  if (looksLikeContactHeader(trimmed, index)) return true;
  if (looksLikeHeaderPhone(trimmed)) return true;
  if (looksLikeGarbled(trimmed)) return true;

  // Drop duplicate consecutive lines (OCR noise)
  if (index > 0 && trimmed === allLines[index - 1]?.trim()) return true;

  return false;
}

function mergeMessageLines(lines) {
  const merged = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (merged.length && merged[merged.length - 1] !== '') merged.push('');
      continue;
    }
    merged.push(trimmed);
  }
  return merged;
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

  if (words.length < 2 || letters < 12) return 'poor';
  if (words.length < 4 || letters < 24 || noiseRatio > 0.28) return 'fair';
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
  const kept = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!shouldDropLine(line, i, rawLines)) {
      kept.push(line.trim());
    }
  }

  const merged = mergeMessageLines(kept);
  const text = normalizeWhitespace(merged.join('\n'));
  const quality = assessExtractionQuality(text);

  return { text, quality };
}
