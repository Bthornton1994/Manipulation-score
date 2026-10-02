// Test-only stand-ins for hosts where the pinned Python extractor cannot
// start (for example, Windows with only the WindowsApps python3 stub). Where
// the real extractor works, as in CI, the seam helpers return {} so
// production defaults run. Production code never imports this file.

import { TRAFILATURA_VERSION, detectTextLanguage } from '../../media-lens/worker/trafilatura-extract.js';

const DOWN_CODES = new Set(['python_version', 'spawn_failed']);
const HERMETIC_VERSION = 'test-hermetic-no-python';
const TEXT_BLOCK_RE = /<(h[1-3]|p|blockquote|li|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;

let downProbe = null;

/** Resolves true only when the local extractor cannot start here. Cached. */
export function pythonExtractorDown() {
  if (!downProbe) {
    downProbe = detectTextLanguage('This is a short English sentence.').then((result) =>
      DOWN_CODES.has(result?.error_code)
    );
  }
  return downProbe;
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function visibleBlockText(html) {
  const source = String(html || '').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');
  const lines = [];
  for (const match of source.matchAll(TEXT_BLOCK_RE)) {
    const line = decodeEntities(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

/** Python success shape, with text taken only from the html argument. */
export function hermeticExtract(html) {
  const text = visibleBlockText(html);
  const htmlLang = /<html\b[^>]*\blang=["']?([A-Za-z-]+)/i.exec(String(html || ''))?.[1] || null;
  return Promise.resolve({
    status: text ? 'ok' : 'empty',
    error_code: text ? null : 'no_text',
    extractor: 'trafilatura',
    // The schema accepts only the pinned extractor version; the detector
    // version marks the result as hermetic.
    extractor_version: TRAFILATURA_VERSION,
    language_detector: 'py3langid',
    language_detector_version: HERMETIC_VERSION,
    detected_language: text ? 'en' : null,
    html_lang: htmlLang,
    title: null,
    author: null,
    date: null,
    text: text || null
  });
}

export function hermeticDetect() {
  return Promise.resolve({
    status: 'ok',
    detected_language: 'en',
    language_detector_version: HERMETIC_VERSION
  });
}

/** `{ extractImpl }` when the extractor is down, otherwise `{}`. */
export async function extractSeam() {
  return (await pythonExtractorDown()) ? { extractImpl: hermeticExtract } : {};
}

/** `{ detectImpl }` when the extractor is down, otherwise `{}`. */
export async function detectSeam() {
  return (await pythonExtractorDown()) ? { detectImpl: hermeticDetect } : {};
}
