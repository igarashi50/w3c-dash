const CACHE_NAME = 'w3c-dash-cache-v3';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/w3c-dash.js',
  '/w3c-api.js',
  '/w3c-dash.css',
  '/w3c-dash.svg',
  '/favicon.ico',
  '/w3c-dash-180x180.png',
  '/w3c-dash-192x192.png',
  '/w3c-dash-512x512.png',
  '/data/w3c-data.json',
  '/data/w3c-groups.json',
  '/data/w3c-participations.json',
  '/data/w3c-affiliations.json',
  '/data/w3c-users.json',
  '/data/w3c-specifications.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(CORE_ASSETS.map(url => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNoCache(req));
    return;
  }

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstNoCache(request) {
  try {
    const res = await fetch(request, { cache: 'no-store' });
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, res.clone());
    return res;
  } catch {
    return caches.match(request);
  }
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, res.clone());
    return res;
  } catch {
    return caches.match(request);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(res => {
    cache.put(request, res.clone());
    return res;
  });

  return cached || fetchPromise;
}
