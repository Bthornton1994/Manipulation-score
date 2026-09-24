// Local Trafilatura bridge. Spawns the pinned Python extractor on HTML or
// plain text already held by the worker. Never passes a URL to fetch.
// The child runs asynchronously so one extraction cannot stall /health.
// Bounds: input size, stdout size, wall time, and concurrent children.
// Timed-out and oversized children are killed. Article text is not logged.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TRAFILATURA_VERSION = '2.2.0';
export const PY3LANGID_VERSION = '0.4.0';
export const EXTRACT_TIMEOUT_MS = 15000;
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_INPUT_BYTES = 3 * 1024 * 1024;
export const MAX_CONCURRENT_EXTRACTIONS = 2;

const SCRIPT_PATH = fileURLToPath(new URL('./trafilatura/extract_html.py', import.meta.url));
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

export function createExtractionGate(maxConcurrent) {
  let active = 0;
  const waiters = [];
  return {
    acquire(timeoutMs) {
      if (active < maxConcurrent) {
        active += 1;
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        let settled = false;
        const grant = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          active += 1;
          resolve(true);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const index = waiters.indexOf(grant);
          if (index >= 0) waiters.splice(index, 1);
          resolve(false);
        }, timeoutMs);
        waiters.push(grant);
      });
    },
    release() {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    }
  };
}

const defaultGate = createExtractionGate(MAX_CONCURRENT_EXTRACTIONS);

function failure(errorCode) {
  return { ...EMPTY_RESULT, error_code: errorCode };
}

function killChild(child) {
  if (!child || child.pid == null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The child has already exited.
    }
  }
}

function spawnExtractor(command, stdin, { timeoutMs, maxOutputBytes, onSpawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], command.slice(1), {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch {
      resolve(failure('spawn_failed'));
      return;
    }

    if (typeof onSpawn === 'function') onSpawn(child);

    let settled = false;
    let timedOut = false;
    let oversized = false;
    let received = 0;
    const chunks = [];

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      chunks.length = 0;
      killChild(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxOutputBytes) {
        oversized = true;
        chunks.length = 0;
        killChild(child);
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on('data', () => {
      // Discard. Extractor failures must not log article text.
    });

    child.on('error', () => {
      killChild(child);
      finish(failure('spawn_failed'));
    });

    child.on('close', (status) => {
      if (timedOut) {
        finish(failure('timeout'));
        return;
      }
      if (oversized) {
        finish(failure('output_limit'));
        return;
      }
      const stdout = Buffer.concat(chunks).toString('utf8').trim();
      chunks.length = 0;
      if (!stdout) {
        finish(failure(status === 0 ? 'empty_output' : 'extractor_exit'));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish(failure('bad_extractor_output'));
          return;
        }
        finish(parsed);
      } catch {
        finish(failure('bad_extractor_output'));
      }
    });

    child.stdin.on('error', () => {
      killChild(child);
    });
    try {
      child.stdin.end(stdin);
    } catch {
      killChild(child);
      finish(failure('spawn_failed'));
    }
  });
}

/**
 * Run one local extraction. Options are for tests (slow command, short
 * timeout, tight output cap). The worker request path uses the defaults.
 */
export async function runExtractor(payload, options = {}) {
  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const command = options.command ?? ['python3', options.scriptPath ?? SCRIPT_PATH];

  let stdin;
  try {
    stdin = JSON.stringify(payload);
  } catch {
    return failure('spawn_failed');
  }
  if (Buffer.byteLength(stdin) > maxInputBytes) return failure('input_limit');

  const gate = options.gate ?? defaultGate;
  const acquired = await gate.acquire(timeoutMs);
  if (!acquired) return failure('busy');
  try {
    return await spawnExtractor(command, stdin, {
      timeoutMs,
      maxOutputBytes,
      onSpawn: options.onSpawn
    });
  } finally {
    gate.release();
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
