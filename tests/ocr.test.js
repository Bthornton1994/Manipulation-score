import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSupportedImageFile, describeImageFile } from '../ocr.js';

function mockFile(name, type = '') {
  return { name, type, size: 1024 };
}

test('isSupportedImageFile accepts common mobile image types', () => {
  assert.equal(isSupportedImageFile(mockFile('photo.heic', 'image/heic')), true);
  assert.equal(isSupportedImageFile(mockFile('photo.HEIF', '')), true);
  assert.equal(isSupportedImageFile(mockFile('shot.webp', 'image/webp')), true);
  assert.equal(isSupportedImageFile(mockFile('msg.jpeg', 'image/jpeg')), true);
  assert.equal(isSupportedImageFile(mockFile('msg.png', '')), true);
});

test('isSupportedImageFile rejects non-images', () => {
  assert.equal(isSupportedImageFile(mockFile('notes.pdf', 'application/pdf')), false);
  assert.equal(isSupportedImageFile(mockFile('doc.txt', 'text/plain')), false);
});

test('describeImageFile reports type or extension', () => {
  assert.match(describeImageFile(mockFile('a.heic', 'image/heic')), /heic/i);
  assert.match(describeImageFile(mockFile('a.png', '')), /png/i);
});

test('ocr.js imports createWorker from tesseract default export', async () => {
  const source = await readFile('ocr.js', 'utf8');
  assert.match(source, /default:\s*Tesseract/);
  assert.match(source, /Tesseract\.createWorker\(/);
  assert.doesNotMatch(source, /const\s*\{\s*createWorker\s*\}\s*=\s*await\s*import\([^)]*tesseract/);
});

test('index CSP allows on-device OCR workers and wasm', async () => {
  const html = await readFile('index.html', 'utf8');
  const match = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(match, 'CSP meta tag present');
  const csp = match[1];
  assert.match(csp, /worker-src[^;]*blob:/);
  assert.match(csp, /script-src[^;]*wasm-unsafe-eval/);
});
