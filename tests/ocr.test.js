import test from 'node:test';
import assert from 'node:assert/strict';
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
