const CACHE_NAME = 'clarity-v37';
const APP_SHELL = [
  './',
  './index.html',
  './analyze.html',
  './learn.html',
  './privacy.html',
  './terms.html',
  './limitations.html',
  './methodology.html',
  './contact.html',
  './acceptable-use.html',
  './accessibility.html',
  './changelog.html',
  './styles.css',
  './fonts.css',
  './app.js',
  './scoring.js',
  './safety.js',
  './text-normalize.js',
  './history-storage.js',
  './ocr.js',
  './ocr-clean.js',
  './manifest.webmanifest',
  './icon.svg',
  './robots.txt',
  './sitemap.xml',
  './vendor/tesseract/tesseract.esm.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core.wasm.js',
  './vendor/tesseract/tesseract-core.wasm',
  './vendor/tesseract/lang/eng.traineddata.gz',
  './vendor/heic2any/heic2any.min.js',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopxhTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAkJxhTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAfJthTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwARZthTg.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk7PFO_F.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4jE-_F.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4aE-_F.ttf'
];

const NETWORK_FIRST_PATTERN =
  /\/(index\.html|analyze\.html|learn\.html|privacy\.html|terms\.html|limitations\.html|methodology\.html|contact\.html|acceptable-use\.html|accessibility\.html|changelog\.html|styles\.css|fonts\.css|app\.js|scoring\.js|safety\.js|text-normalize\.js|history-storage\.js|service-worker\.js)$/;

function isNetworkFirstRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path.endsWith('/') || path === '') return true;
  return NETWORK_FIRST_PATTERN.test(path);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('network and cache miss');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirstRequest(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
