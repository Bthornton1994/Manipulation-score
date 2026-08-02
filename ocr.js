const TESSERACT_BASE = new URL('./vendor/tesseract/', import.meta.url);

let workerInstance = null;
let workerBusy = false;

async function createOcrWorker() {
  const { createWorker } = await import('./vendor/tesseract/tesseract.esm.min.js');
  return createWorker('eng', 1, {
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
    const worker = await getWorker();
    const { data } = await worker.recognize(file);
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
