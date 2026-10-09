// BLOCK:SW — offline shell for the Nexus CMS PWA (network-first, versioned)
const CACHE = 'nexus-cms-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;   // same-origin GET only
  if (u.pathname.startsWith('/api/')) return;                                     // never cache API
  e.respondWith(
    fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/')))
  );
});
