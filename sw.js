const CACHE_NAME = 'w3c-dash-cache-v1';
const FILES_TO_CACHE = [
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
  // データファイル
  '/data/w3c-data.json',
  '/data/w3c-groups.json',
  '/data/w3c-participants.json',
  '/data/w3c-affiliations.json',
  '/data/w3c-users.json',
];

// インストール時に最低限のファイルをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// fetch時の戦略：オンラインならネットワーク＋キャッシュ更新、オフライン時はキャッシュ
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // レスポンスをキャッシュに保存
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});