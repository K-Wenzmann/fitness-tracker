// Service worker for the Fitness Tracker.
//
// Strategy: network-first. Every request tries the network so a new index.html shows up on the next
// reload, with no manual version bump per deploy. Each successful response is copied into the cache,
// and the cache is only used when the network fails (offline, or a CDN is unreachable). That covers the
// CDN scripts (Tailwind, Chart.js, React, Babel) as well as the local files.
//
// CACHE_NAME only needs bumping to throw away everything cached so far.
const CACHE_NAME = 'fitness-tracker-cache-v3';

// Local files to pre-cache on install.
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// Pre-cache each file on its own. With cache.addAll, one missing file (e.g. an icon that
// 404s) makes the whole install fail and the service worker never activates.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(urlsToCache.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// Remove caches from older versions and take control of open tabs right away.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Network first, cache as the fallback.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Keep a copy of good responses (opaque = cross-origin script loaded without CORS).
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          // Offline navigation to a URL we never cached: fall back to the app shell.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
