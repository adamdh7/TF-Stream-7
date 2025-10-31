// /sw.js
const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
const VIDEO_CACHE = 'tfstream-video-v1'; // <-- défini maintenant
const OFFLINE_URL = '/offline.html';
const PLACEHOLDER = '/images/placeholder-thumb.png';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  OFFLINE_URL,
  '/styles.css',
  '/main.js',
  PLACEHOLDER
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.allSettled(
      PRECACHE_URLS.map(u =>
        fetch(u, { cache: 'no-cache' }).then(res => {
          if (!res.ok && res.type !== 'opaque') throw new Error(`${u} -> ${res.status}`);
          return cache.put(new Request(u), res.clone());
        }).catch(err => {
          console.warn('Precache failed for', u, err);
        })
      )
    );

    // chargement et cache des thumbs / json references
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const index = await resp.json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);
        const videoCache = await caches.open(VIDEO_CACHE);

        const urls = new Set();

        if (Array.isArray(index)) {
          index.forEach(it => {
            if (it['Url Thumb']) urls.add(absoluteUrl(it['Url Thumb']));
            if (it.video) urls.add(absoluteUrl(it.video));
          });
        } else {
          Object.values(index).forEach(v => {
            if (typeof v === 'string' && (v.endsWith('.json') || /\.(jpg|jpeg|png|webp|mp4|m3u8)$/i.test(v))) {
              urls.add(absoluteUrl(v));
            }
          });
        }

        await Promise.allSettled(Array.from(urls).map(u => {
          if (u.endsWith('.json')) {
            return fetch(u, {cache:'no-cache'}).then(r => { if (r && (r.ok || r.type === 'opaque')) return jsonCache.put(new Request(u), r.clone()); }).catch(()=>{});
          }
          if (/\.(mp4|m3u8|webm|mpd)$/i.test(u)) {
            return fetch(u, {mode:'no-cors'}).then(r => { if (r) return videoCache.put(new Request(u), r.clone()); }).catch(()=>{});
          }
          if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) {
            return fetch(u, {mode:'no-cors'}).then(r => { if (r) return imageCache.put(new Request(u), r.clone()); }).catch(()=>{});
          }
          return Promise.resolve();
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch index.json during install', e);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evt => {
  evt.waitUntil((async () => {
    const expected = [CACHE_NAME, IMAGE_CACHE, JSON_CACHE, VIDEO_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (!expected.includes(k)) {
        return caches.delete(k);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

function absoluteUrl(u){
  try {
    return new URL(u, self.location.href).href;
  } catch(e) {
    return u;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  const url = req.url;

  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif)$/.test(url)) {
    event.respondWith(cacheFirstWithFallback(req, IMAGE_CACHE, PLACEHOLDER));
    return;
  }

  if (url.endsWith('.json')) {
    event.respondWith(networkFirst(req, JSON_CACHE));
    return;
  }

  if (/\.(mp4|m3u8|webm|mpd)$/i.test(url)) {
    event.respondWith(cacheFirst(req, VIDEO_CACHE));
    return;
  }

  event.respondWith(cacheFirst(req));
});

// Strategies
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && (resp.ok || resp.type === 'opaque')) {
      cache.put(request, resp.clone()).catch(()=>{});
    }
    return resp;
  } catch (e) {
    return caches.match(OFFLINE_URL);
  }
}

async function networkFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(()=>{});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request) || await caches.match(OFFLINE_URL);
    return cached;
  }
}

async function cacheFirstWithFallback(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && (resp.ok || resp.type === 'opaque')) {
      await cache.put(request, resp.clone());
      return resp;
    }
  } catch (e) {}
  return caches.match(fallbackUrl);
                                                                                                                         }
