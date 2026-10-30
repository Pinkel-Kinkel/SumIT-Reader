// Serves the stored summaries (from IndexedDB) under ./v/<id>/<path>, and the reader itself from its cache, so everything works offline.
const SHELL = 'sumit-reader-shell-v1';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'fflate.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf' };

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('sumit-reader', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'id' }); r.result.createObjectStore('files'); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
function getFile(db, key) {
  return new Promise((resolve, reject) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(base + 'v/')) {
    e.respondWith((async () => {
      const rest = url.pathname.slice(base.length + 2).split('/').map(decodeURIComponent);
      const key = rest.join('/');
      const rec = await getFile(await openDb(), key);
      if (!rec) return new Response('הקובץ לא נמצא בסיכום', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      const ext = key.split('.').pop().toLowerCase();
      return new Response(rec, { status: 200, headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
    })());
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});