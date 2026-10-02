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

// Network first, cache as the fallback. On a weak connection a request that hasn't answered within
// NETWORK_TIMEOUT_MS is served from the cache instead (if there is a copy); the network request keeps
// running in the background and refreshes the cache for next time.
// After one timeout the connection is treated as slow for SLOW_MODE_MS: requests that have a cached copy are
// answered from it straight away, so a page with many files doesn't wait 3 s for each round of requests.
const NETWORK_TIMEOUT_MS = 3000;
const SLOW_MODE_MS = 60000;
let slowUntil = 0;

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  event.respondWith((async () => {
    const networkPromise = fetch(request).then(response => {
      // Keep a copy of good responses (opaque = cross-origin script loaded without CORS).
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    });
    event.waitUntil(networkPromise.catch(() => {}));   // let a slow request finish and refresh the cache

    if (Date.now() < slowUntil) {
      const hit = await caches.match(request);
      if (hit) return hit;
    }

    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS); });
    try {
      return await Promise.race([networkPromise, timeout]);
    } catch (err) {
      if (err && err.message === 'timeout') slowUntil = Date.now() + SLOW_MODE_MS;
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      // Nothing cached: keep waiting for the network, or fail if it fails.
      try { return await networkPromise; } catch (e) { return Response.error(); }
    } finally {
      clearTimeout(timer);
    }
  })());
});
