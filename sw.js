const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/styles.css',   // si w genyen
  '/main.js'       // si w genyen
];

// Install - precache app shell
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate - cleanup old caches
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (![CACHE_NAME, IMAGE_CACHE, JSON_CACHE].includes(k)) return caches.delete(k);
      })
    )).then(() => self.clients.claim())
  );
});

// Helper: cache-first for images
async function handleImageRequest(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    // fallback placeholder (should be precached in PRECACHE_URLS)
    return caches.match('/images/placeholder-thumb.png');
  }
}

// Helper: network-first for .json (fallback to cache)
async function handleJsonRequest(req) {
  const cache = await caches.open(JSON_CACHE);
  try {
    const networkResp = await fetch(req);
    if (networkResp && networkResp.ok) {
      cache.put(req, networkResp.clone());
    }
    return networkResp;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response(JSON.stringify({ error: 'offline' }), { headers: { 'Content-Type': 'application/json' }});
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) images (thumbs) - cache-first
  if (req.destination === 'image' || /\/thumbs\/|\.jpg$|\.jpeg$|\.png$|\.webp$/.test(url.pathname)) {
    event.respondWith(handleImageRequest(req));
    return;
  }

  // 2) json files - network-first
  if (url.pathname.endsWith('.json')) {
    event.respondWith(handleJsonRequest(req));
    return;
  }

  // 3) navigation / shell - try cache then network, fallback offline page
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      caches.match(req).then(res => res || fetch(req).catch(() => caches.match('/offline.html')))
    );
    return;
  }

  // 4) default: try cache then network
  event.respondWith(
    caches.match(req).then(res => res || fetch(req).catch(() => caches.match('/offline.html')))
  );
});
