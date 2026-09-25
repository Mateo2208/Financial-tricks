// Offline: la app (HTML, CSS, JS, íconos) se guarda en el celular para abrir sin señal.
// La API nunca se cachea: los registros sin señal los guarda app.js y los manda al volver.
// Cambiar VERSION en cada deploy del front.
const VERSION = 'qc-2026-09-26-4';
const APP = ['/', '/app.css?v=4', '/app.js?v=4', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Red primero (siempre la versión nueva con señal); sin señal, la copia guardada
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp.ok) { const copia = resp.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
        return resp;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
