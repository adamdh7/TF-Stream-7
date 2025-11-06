// /sw.js  (improved)
'use strict';

const CACHE_NAME = 'tfstream-shell-v2';
const IMAGE_CACHE = 'tfstream-thumbs-v2';
const JSON_CACHE = 'tfstream-json-v2';
const OFFLINE_URL = '/offline.html';
const PLACEHOLDER = '/asset/placeholder-thumb.png'; // adapte chemen an si ou genyen

const PRECACHE_URLS = [
  '/', // index route
  '/index.html',
  '/manifest.json',
  OFFLINE_URL,
  '/styles.css',
  '/main.js'
  // NOTE: pa mete videyo isit la
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // pre-cache main shell
    await Promise.allSettled(
      PRECACHE_URLS.map(u =>
        fetch(u, { cache: 'no-cache' }).then(res => {
          if (!res || (!res.ok && res.type !== 'opaque')) throw new Error(`${u} -> ${res && res.status}`);
          return cache.put(new Request(u, { credentials: 'same-origin' }), res.clone());
        }).catch(err => {
          // don't fail the whole install if some precache items fail (robust)
          console.warn('Precache failed for', u, err && err.message);
        })
      )
    );

    // Try to fetch index.json and pre-cache referenced thumbs & json metadata
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const index = await resp.json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);

        const urls = new Set();

        // support both array and object forms
        if (Array.isArray(index)) {
          index.forEach(it => {
            if (it['Url Thumb']) urls.add(absoluteUrl(it['Url Thumb']));
            if (it['Url'] && typeof it['Url'] === 'string' && /\.(json)$/i.test(it['Url'])) urls.add(absoluteUrl(it['Url']));
            // Saisons/episodes scanning
            if (Array.isArray(it.Saisons)) {
              it.Saisons.forEach(s => {
                if (s.thumb) urls.add(absoluteUrl(s.thumb));
                if (s.description && typeof s.description === 'string' && s.description.endsWith('.json')) urls.add(absoluteUrl(s.description));
                if (Array.isArray(s.episodes)) {
                  s.episodes.forEach(ep => {
                    if (ep.thumb) urls.add(absoluteUrl(ep.thumb));
                    if (ep.description && ep.description.endsWith('.json')) urls.add(absoluteUrl(ep.description));
                  });
                }
              });
            }
          });
        } else {
          Object.values(index).forEach(v => {
            if (typeof v === 'string' && /\.(jpg|jpeg|png|webp|json)$/i.test(v)) urls.add(absoluteUrl(v));
          });
        }

        // fetch and cache images/jsons (no videos)
        await Promise.allSettled(Array.from(urls).map(u => {
          if (!u) return Promise.resolve();
          if (u.endsWith('.json')) {
            return fetch(u, { cache: 'no-cache' })
              .then(r => { if (r && (r.ok || r.type === 'opaque')) return jsonCache.put(new Request(u), r.clone()); })
              .catch(()=>{});
          }
          if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) {
            // no-cors to accept cross-origin images (opaque)
            return fetch(u, { mode: 'no-cors' })
              .then(r => { if (r) return imageCache.put(new Request(u), r.clone()); })
              .catch(()=>{});
          }
          return Promise.resolve();
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch index.json during install', e && e.message);
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

/* FETCH ROUTES */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navigation/page -> networkFirst (then cache fallback)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Images (thumbnails) -> cacheFirstWithFallback
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif)$/.test(url.pathname)) {
    event.respondWith(cacheFirstWithFallback(req, IMAGE_CACHE, PLACEHOLDER));
    return;
  }

  // JSON -> networkFirst and cache into JSON_CACHE
  if (url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(req, JSON_CACHE));
    return;
  }

  // Videos -> network only (never cache)
  if (/\.(mp4|webm|m3u8|mpd|mkv)$/i.test(url.pathname)) {
    event.respondWith(networkOnly(req));
    return;
  }

  // Default -> cacheFirst using main shell cache
  event.respondWith(cacheFirst(req));
});

/* STRATEGIES */
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

async function networkOnly(request) {
  try {
    const resp = await fetch(request);
    if (resp && (resp.ok || resp.type === 'opaque')) return resp;
    return resp; // forward non-ok response
  } catch (err) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
  }
}

/* MESSAGE - allow page to tell SW to pre-cache additional URLs (e.g. thumbs/descriptions) */
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data && data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    caches.open(IMAGE_CACHE).then(cache => {
      data.urls.forEach(u => {
        try {
          const req = new Request(u, { mode: 'no-cors' });
          fetch(u, { mode: 'no-cors' }).then(r => {
            if (r) cache.put(req, r.clone()).catch(()=>{});
          }).catch(()=>{});
        } catch(e){}
      });
    });
  }
});

/* PUSH / NOTIFICATION HANDLERS
   Expected push payload (json) examples:
   { "title":"TF-Stream vous propose", "body":"New episode ...", "url":"/my-slug", "icon":"...","badge":"...", "data":{...} }
   Fallback for text payloads is supported.
*/
self.addEventListener('push', function(event) {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    // not JSON, fall back to text
    try { payload = { body: event.data.text() }; } catch(e2){ payload = {}; }
  }

  const title = payload.title || 'TF-Stream';
  const body = payload.body || payload.message || 'Cliquez pour voir';
  const icon = payload.icon || '/asset/192.png';
  const badge = payload.badge || '/asset/192.png';
  const tag = payload.tag || ('tfstream-' + Date.now());
  const data = payload.data || {};
  // optionally include a url or slug for click handling
  if (payload.url) data.url = payload.url;
  if (payload.slug) data.slug = payload.slug;

  const actions = Array.isArray(payload.actions) ? payload.actions : [];

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: false,
    data,
    actions
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const data = event.notification.data || {};
  // prefer a full absolute url in data.url, or construct from slug
  let urlToOpen = '/';
  if (data.url) {
    try { urlToOpen = new URL(data.url, self.location.origin).href; }
    catch(e){ urlToOpen = data.url; }
  } else if (data.slug) {
    urlToOpen = new URL('/' + data.slug, self.location.origin).href;
  }

  event.waitUntil((async () => {
    // focus existing client if possible
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      const cUrl = c.url || '';
      // if client has same origin, focus and post message to navigate
      try {
        if (cUrl.indexOf(self.location.origin) === 0) {
          await c.focus();
          // tell the page to navigate to url (client should implement message handler)
          c.postMessage({ type: 'NOTIF_NAVIGATE', url: urlToOpen });
          return;
        }
      } catch(e){}
    }
    // no client found: open a new window
    await clients.openWindow(urlToOpen);
  })());
});

self.addEventListener('notificationclose', function(event){
  // optional: you can report to server that user dismissed notification
  // e.g. fetch('/notif-dismiss', { method:'POST', body: JSON.stringify({ tag: event.notification.tag })});
});
