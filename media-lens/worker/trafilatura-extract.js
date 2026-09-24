// Local Trafilatura bridge. Spawns the pinned Python extractor on HTML or
// plain text already held by the worker. Never passes a URL to fetch.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TRAFILATURA_VERSION = '2.2.0';
export const PY3LANGID_VERSION = '0.4.0';

const SCRIPT_PATH = fileURLToPath(new URL('./trafilatura/extract_html.py', import.meta.url));
const EXTRACT_TIMEOUT_MS = 15000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const EMPTY_RESULT = {
  status: 'error',
  error_code: 'extractor_unavailable',
  extractor: 'trafilatura',
  extractor_version: null,
  language_detector: 'py3langid',
  language_detector_version: null,
  detected_language: null,
  html_lang: null,
  title: null,
  author: null,
  date: null,
  text: null
};

function runExtractor(payload) {
  let result;
  try {
    result = spawnSync('python3', [SCRIPT_PATH], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true
    });
  } catch {
    return { ...EMPTY_RESULT, error_code: 'spawn_failed' };
  }

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    return { ...EMPTY_RESULT, error_code: timedOut ? 'timeout' : 'spawn_failed' };
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (!stdout) {
    return { ...EMPTY_RESULT, error_code: result.status === 0 ? 'empty_output' : 'extractor_exit' };
  }

  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_RESULT, error_code: 'bad_extractor_output' };
    return parsed;
  } catch {
    return { ...EMPTY_RESULT, error_code: 'bad_extractor_output' };
  }
}

export function extractLocalArticle(html) {
  return runExtractor({ html });
}

export function detectTextLanguage(text) {
  return runExtractor({ text });
}

export function primaryLanguageSubtag(value) {
  if (!value || typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(tag) ? tag : null;
}

/**
 * Schema language is only "en" when detection says English and the declared
 * html lang, if any, does not disagree. Anything else stays "und".
 */
export function schemaLanguage({ detected, htmlLang } = {}) {
  const detectedCode = primaryLanguageSubtag(detected);
  const declared = primaryLanguageSubtag(htmlLang);
  if (detectedCode === 'en' && (declared === null || declared === 'en')) return 'en';
  return 'und';
}
