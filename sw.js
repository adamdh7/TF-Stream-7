// /sw.js
const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
// NOTE: VIDEO_CACHE removed so videos won't be cached
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

    // chargement et cache des thumbs / json references (NE PAS CACHER LES VIDÉOS)
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const index = await resp.json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);

        const urls = new Set();

        // Récupère uniquement les images et fichiers json référencés, IGNORE les vidéos
        if (Array.isArray(index)) {
          index.forEach(it => {
            if (it['Url Thumb']) urls.add(absoluteUrl(it['Url Thumb']));
            // si des champs contiennent .json on peut ajouter (ex: subs, metadata)
            if (it.info && typeof it.info === 'string' && it.info.endsWith('.json')) {
              urls.add(absoluteUrl(it.info));
            }
            // Si structure contient saisons/episodes avec mini-urls, on prend uniquement images/json
            if (Array.isArray(it.Saisons)) {
              it.Saisons.forEach(s => {
                if (s.description && s.description.endsWith('.json')) urls.add(absoluteUrl(s.description));
                if (Array.isArray(s.episodes)) {
                  s.episodes.forEach(ep => {
                    if (ep.thumbnail) urls.add(absoluteUrl(ep.thumbnail));
                    if (ep.video && typeof ep.video === 'string' && ep.video.endsWith('.json')) urls.add(absoluteUrl(ep.video));
                  });
                }
              });
            }
          });
        } else {
          Object.values(index).forEach(v => {
            if (typeof v === 'string' && (v.endsWith('.json') || /\.(jpg|jpeg|png|webp)$/i.test(v))) {
              urls.add(absoluteUrl(v));
            }
          });
        }

        await Promise.allSettled(Array.from(urls).map(u => {
          if (u.endsWith('.json')) {
            return fetch(u, { cache: 'no-cache' })
              .then(r => { if (r && (r.ok || r.type === 'opaque')) return jsonCache.put(new Request(u), r.clone()); })
              .catch(()=>{});
          }
          if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) {
            return fetch(u, { mode: 'no-cors' })
              .then(r => { if (r) return imageCache.put(new Request(u), r.clone()); })
              .catch(()=>{});
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
    const expected = [CACHE_NAME, IMAGE_CACHE, JSON_CACHE];
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

  // navigation -> networkFirst for pages
  if (req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  const url = req.url;

  // images -> cacheFirstWithFallback
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif)$/.test(url)) {
    event.respondWith(cacheFirstWithFallback(req, IMAGE_CACHE, PLACEHOLDER));
    return;
  }

  // json -> networkFirst but cached in JSON_CACHE
  if (url.endsWith('.json')) {
    event.respondWith(networkFirst(req, JSON_CACHE));
    return;
  }

  // videos -> DO NOT CACHE: use network only (fetch directly). On failure provide offline page (or 502).
  if (/\.(mp4|m3u8|webm|mpd|mkv)$/i.test(url)) {
    event.respondWith(networkOnly(req));
    return;
  }

  // default -> cacheFirst
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

// NETWORK ONLY strategy for videos: never write to cache
async function networkOnly(request) {
  try {
    // keep the fetch as direct as possible; do not attempt to cache
    const resp = await fetch(request);
    // If fetch succeeded but response is opaque (no-cors), still return it
    if (resp && (resp.ok || resp.type === 'opaque')) return resp;
    // If non-ok, forward the response (so client gets proper status)
    return resp;
  } catch (err) {
    // On failure (offline), return offline page or a generic Response with 503
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
  }
}
