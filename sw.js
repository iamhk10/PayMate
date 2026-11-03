/* =========================================================================
   PayMate — sw.js  (service worker)

   • Precaches the whole app on first visit → PayMate opens instantly and works offline.
   • HTML / CSS / JS: network-first (always the latest when online, cached copy when offline).
   • Fonts, icons, vendor libraries: cache-first (they never change between releases).
   • PDF / JPG libraries from the CDN are cached the first time they are used,
     so downloads keep working offline afterwards.

   HOW TO RELEASE AN UPDATE: change VERSION below, upload the files. Visitors get a
   small "A new version is ready — Reload" bar.
   ========================================================================= */
const VERSION = 'paymate-v1.0.1';
const LIBS = 'paymate-libs-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/fonts.css', 'css/style.css', 'css/bill.css',
  'js/config.js', 'js/storage.js', 'js/bill.js', 'js/templates.js', 'js/export.js', 'js/pwa.js', 'js/app.js',
  'js/vendor/qrcode.js',
  'icons/icon.svg', 'icons/favicon.svg', 'icons/favicon-32.png', 'icons/favicon-16.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/poppins-400.woff', 'fonts/poppins-500.woff', 'fonts/poppins-700.woff',
  'fonts/adventor-400.woff', 'fonts/adventor-700.woff', 'fonts/schola-700.woff', 'fonts/bonum-700.woff',
  'fonts/heros-400.woff', 'fonts/heros-700.woff', 'fonts/cursor-400.woff', 'fonts/cursor-700.woff',
  'fonts/chorus-500i.woff', 'fonts/lora-var.woff',
  'fonts/rupee-400.woff', 'fonts/rupee-500.woff', 'fonts/rupee-700.woff', 'fonts/symbols.woff'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const STATIC_DIRS = ['/fonts/', '/icons/', '/js/vendor/'];

/* ------------------------------------------------------------------ install */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // add files one by one so a single missing file can never break the install
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    )
  );
  // no skipWaiting() here on purpose: the page asks for it when the visitor taps "Reload"
});

/* ----------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('paymate-') && k !== VERSION && k !== LIBS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* -------------------------------------------------------------------- fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN libraries (html2canvas, jsPDF): cache-first, stored the first time they load
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, LIBS));
    return;
  }
  if (url.origin !== self.location.origin) return;           // other sites (e.g. the feedback form) → straight to the network

  if (STATIC_DIRS.some((d) => url.pathname.includes(d))) {
    event.respondWith(cacheFirst(req, VERSION));
    return;
  }
  event.respondWith(networkFirst(req));
});

function cacheFirst(req, cacheName) {
  return caches.match(req).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    });
  });
}

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () =>
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : null) || caches.match('./'));
    // if the network is very slow, show the cached copy instead of waiting
    const timer = setTimeout(() => { fromCache().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } }); }, 4000);

    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((hit) => { if (!settled) { settled = true; resolve(hit || Response.error()); } });
    });
  });
}
