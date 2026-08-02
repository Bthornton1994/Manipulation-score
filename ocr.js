const TESSERACT_BASE = new URL('./vendor/tesseract/', import.meta.url);
const HEIC2ANY_URL = new URL('./vendor/heic2any/heic2any.min.js', import.meta.url).href;

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const HEIC_TYPES = new Set(['image/heic', 'image/heif']);

let workerInstance = null;
let workerBusy = false;
let heic2anyPromise = null;

function getExtension(filename) {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

export function describeImageFile(file) {
  const ext = getExtension(file.name || '');
  const type = (file.type || '').toLowerCase();
  if (type) return `${type}${ext ? ` (.${ext})` : ''}`;
  return ext ? `.${ext}` : 'image';
}

export function isSupportedImageFile(file) {
  const ext = getExtension(file.name || '');
  const type = (file.type || '').toLowerCase();

  if (ext && SUPPORTED_EXTENSIONS.has(ext)) return true;
  if (type.startsWith('image/')) return true;
  return false;
}

function isHeicFile(file) {
  const ext = getExtension(file.name || '');
  const type = (file.type || '').toLowerCase();
  return HEIC_EXTENSIONS.has(ext) || HEIC_TYPES.has(type);
}

async function loadHeic2any() {
  if (!heic2anyPromise) {
    heic2anyPromise = new Promise((resolve, reject) => {
      if (window.heic2any) {
        resolve(window.heic2any);
        return;
      }
      const script = document.createElement('script');
      script.src = HEIC2ANY_URL;
      script.async = true;
      script.onload = () => {
        if (window.heic2any) resolve(window.heic2any);
        else reject(new Error('HEIC converter failed to load'));
      };
      script.onerror = () => reject(new Error('HEIC converter failed to load'));
      document.head.append(script);
    });
  }
  return heic2anyPromise;
}

async function convertHeicToJpeg(file) {
  const heic2any = await loadHeic2any();
  const converted = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const baseName = file.name.replace(/\.(heic|heif)$/i, '') || 'image';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

async function normalizeRasterImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.png`, { type: 'image/png' });
  } catch {
    return file;
  }
}

/**
 * Prepare an image file for on-device OCR (HEIC conversion, raster normalization).
 */
export async function prepareImageForOcr(file) {
  if (!isSupportedImageFile(file)) {
    const error = new Error('unsupported');
    error.code = 'UNSUPPORTED_IMAGE';
    throw error;
  }

  if (isHeicFile(file)) {
    try {
      return await convertHeicToJpeg(file);
    } catch {
      const error = new Error('heic');
      error.code = 'HEIC_CONVERT_FAILED';
      throw error;
    }
  }

  return normalizeRasterImage(file);
}

async function createOcrWorker() {
  const { default: Tesseract } = await import('./vendor/tesseract/tesseract.esm.min.js');
  return Tesseract.createWorker('eng', 1, {
    workerPath: new URL('worker.min.js', TESSERACT_BASE).href,
    corePath: new URL('tesseract-core.wasm.js', TESSERACT_BASE).href,
    langPath: new URL('lang/', TESSERACT_BASE).href,
    cacheMethod: 'none'
  });
}

async function getWorker() {
  if (!workerInstance) {
    workerInstance = await createOcrWorker();
  }
  return workerInstance;
}

/**
 * Extract text from an image entirely on-device via Tesseract.js.
 * The image is not uploaded or stored by Clarity.
 */
export async function extractTextFromImage(file) {
  while (workerBusy) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  workerBusy = true;
  try {
    const prepared = await prepareImageForOcr(file);
    const worker = await getWorker();
    const { data } = await worker.recognize(prepared);
    return (data.text || '').trim();
  } finally {
    workerBusy = false;
  }
}

export async function releaseOcrWorker() {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
}
