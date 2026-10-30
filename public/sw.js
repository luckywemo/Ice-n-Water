// minimal installability worker — Chrome requires a fetch handler before it
// will fire beforeinstallprompt. Strategy: Vite's hashed /assets/ are
// immutable → cache-first; everything else same-origin → network-first with
// a cache fallback so an installed copy still boots offline.
const CACHE = 'icenwater-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  const put = (res) => {
    if (res.ok && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE).then((m) => m.put(request, clone));
    }
    return res;
  };
  // resolve <sw-dir>/assets/ — Vite emits hashed, immutable files there
  const assetsPrefix = new URL('./assets/', self.location.href).pathname;
  if (new URL(request.url).pathname.startsWith(assetsPrefix)) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(put)));
    return;
  }
  e.respondWith(fetch(request).then(put).catch(() => caches.match(request)));
});
