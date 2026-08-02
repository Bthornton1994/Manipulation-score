import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedImageFile, describeImageFile } from '../ocr.js';
import { cleanScreenshotText, assessExtractionQuality } from '../ocr-clean.js';

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

test('cleanScreenshotText removes status bar and header noise from real OCR junk', () => {
  const raw = [
    '12:37 N\\ all TE',
    'Lauren)',
    '3 Lauren x',
    '@ Encrypted',
    'If you really cared you would answer right now'
  ].join('\n');

  const { text, quality } = cleanScreenshotText(raw);
  assert.match(text, /If you really cared you would answer right now/i);
  assert.doesNotMatch(text, /12:37/i);
  assert.doesNotMatch(text, /Lauren/i);
  assert.doesNotMatch(text, /Encrypted/i);
  assert.notEqual(quality, 'empty');
});

test('cleanScreenshotText returns empty when only chrome remains', () => {
  const raw = ['12:37', 'LTE', '@ Encrypted', 'Lauren)', '3 Lauren x'].join('\n');
  const { text, quality } = cleanScreenshotText(raw);
  assert.equal(text, '');
  assert.equal(quality, 'empty');
});

test('cleanScreenshotText removes common chat UI chrome', () => {
  const raw = [
    '9:41',
    'LTE',
    '87%',
    'Mom',
    'iMessage',
    'Delivered',
    'If you really cared you would answer right now',
    'Today 3:45 PM',
    'Read',
    'Show in Calendar'
  ].join('\n');

  const { text, quality } = cleanScreenshotText(raw);
  assert.match(text, /If you really cared you would answer right now/i);
  assert.doesNotMatch(text, /iMessage/i);
  assert.doesNotMatch(text, /Delivered/i);
  assert.doesNotMatch(text, /Show in Calendar/i);
  assert.doesNotMatch(text, /\bMom\b/);
  assert.notEqual(quality, 'empty');
});

test('cleanScreenshotText keeps phone numbers inside message sentences', () => {
  const raw = '(555) 123-4567\nCall me at 555-123-4567 when you can';
  const { text } = cleanScreenshotText(raw);
  assert.match(text, /Call me at 555-123-4567/i);
  assert.doesNotMatch(text, /^\(555\)/m);
});

test('cleanScreenshotText drops garbled OCR noise', () => {
  const raw = '||| @@ ##\nWhy are you ignoring me again?\n~~~';
  const { text } = cleanScreenshotText(raw);
  assert.match(text, /Why are you ignoring me again/i);
  assert.doesNotMatch(text, /@/);
});

test('assessExtractionQuality flags poor noisy extractions', () => {
  assert.equal(assessExtractionQuality('||| @@'), 'poor');
  assert.equal(assessExtractionQuality(''), 'empty');
  assert.equal(
    assessExtractionQuality('If you really cared you would answer right now please'),
    'good'
  );
});

test('cleanScreenshotText preserves multi-line messages', () => {
  const raw = [
    'Delivered',
    'I need an answer immediately.',
    'This is your last chance.',
    'Read'
  ].join('\n');

  const { text } = cleanScreenshotText(raw);
  assert.match(text, /I need an answer immediately/);
  assert.match(text, /This is your last chance/);
});
