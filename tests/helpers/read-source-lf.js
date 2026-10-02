// Read a worker source file with line endings normalized to LF.
// Windows checkouts with core.autocrlf=true materialize CRLF, while mutation
// anchors and source assertions in tests are written with LF. Without this,
// multi-line mutators silently fail to match and "mutator must change the
// source" trips on Windows only.

import { readFile } from 'node:fs/promises';

export function normalizeLf(text) {
  return text.replace(/\r\n/g, '\n');
}

export async function readSourceLf(path) {
  return normalizeLf(await readFile(path, 'utf8'));
}
