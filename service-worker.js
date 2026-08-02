const CACHE_NAME = 'clarity-v5';
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './limitations.html',
  './styles.css',
  './fonts.css',
  './app.js',
  './scoring.js',
  './manifest.webmanifest',
  './icon.svg',
  './robots.txt',
  './sitemap.xml',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopxhTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAkJxhTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAfJthTg.ttf',
  './fonts/dmsans-v17-rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwARZthTg.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk7PFO_F.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4jE-_F.ttf',
  './fonts/manrope-v20-xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4aE-_F.ttf'
];

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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
