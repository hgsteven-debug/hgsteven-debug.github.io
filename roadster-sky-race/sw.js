// 同網域的靜態檔在連得上時更新快取，斷線時用上次成功的回應。
// v8：手機直向改成全螢幕轉橫提示，橫向用可視範圍鋪滿。activate 會丟掉舊快取。
const CACHE = 'sky-roadster-v8';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw e;
    }
  })());
});
