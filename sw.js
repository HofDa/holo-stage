// App-shell cache so the stage works offline. Videos live in IndexedDB, not here.
const CACHE = 'holo-stage-v15';
const SHELL = ['./', 'index.html', 'style.css', 'i18n.js', 'app.js', 'story.js', 'ui.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the browser's HTTP cache so a new version is really fetched
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the shell (so updates arrive), cache as offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/demo/')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })   // always revalidate with the server
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
