/* sw.js - TF-Stream (video-safe: metadata & thumbs only, never cache video files) */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `tfstream-shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `tfstream-thumbs-${CACHE_VERSION}`;
const JSON_CACHE  = `tfstream-json-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const PLACEHOLDER = '/asset/192.png';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json', OFFLINE_URL, PLACEHOLDER];

// Extensions patterns
const IMAGE_RE = /\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i;
const JSON_RE  = /\.json(\?.*)?$/i;
const VIDEO_RE = /\.(mp4|webm|m3u8|mpd|mkv|mov)(\?.*)?$/i;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Precache shell
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async u => {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(new Request(u), res.clone());
        }
      } catch (e) { /* ignore individual prefetch errors */ }
    }));

    // Try to read index.json and pre-cache thumbs + metadata only (no video)
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const json = await resp.clone().json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache  = await caches.open(JSON_CACHE);
        const urls = new Set();

        function addIfSafe(u){
          if(!u || typeof u !== 'string') return;
          const href = new URL(u, self.registration.scope).href;
          if (VIDEO_RE.test(href)) return; // skip videos always
          if (IMAGE_RE.test(href) || JSON_RE.test(href) || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(href)) urls.add(href);
        }

        if (Array.isArray(json)) {
          json.forEach(it => {
            if (!it || typeof it !== 'object') return;
            // thumbs
            if (it['Url Thumb']) addIfSafe(it['Url Thumb']);
            if (it.thumb) addIfSafe(it.thumb);
            // info fields (some projects store metadata json links)
            if (it.info && typeof it.info === 'string') addIfSafe(it.info);
            // seasons/episodes thumbs
            if (Array.isArray(it.Saisons)) {
              it.Saisons.forEach(s => {
                if (!s || typeof s !== 'object') return;
                if (s.description && typeof s.description === 'string') addIfSafe(s.description);
                if (Array.isArray(s.episodes)) {
                  s.episodes.forEach(ep => {
                    if (!ep || typeof ep !== 'object') return;
                    if (ep.thumb) addIfSafe(ep.thumb);
                    if (ep.thumbnail) addIfSafe(ep.thumbnail);
                    // DO NOT add ep.video or ep.stream (they are video files)
                  });
                }
              });
            }
          });
        } else if (json && typeof json === 'object') {
          Object.values(json).forEach(v => {
            if (!v) return;
            if (typeof v === 'string') addIfSafe(v);
            else if (typeof v === 'object') {
              if (v['Url Thumb']) addIfSafe(v['Url Thumb']);
              if (v.thumb) addIfSafe(v.thumb);
            }
          });
        }

        // Fetch and cache images/json safely
        await Promise.all(Array.from(urls).map(async u => {
          try {
            if (JSON_RE.test(u)) {
              const r = await fetch(u, { cache: 'no-cache' });
              if (r && (r.ok || r.type === 'opaque')) await jsonCache.put(new Request(u), r.clone());
            } else if (IMAGE_RE.test(u)) {
              // use no-cors for cross-origin images if necessary
              const r = await fetch(u, { mode: 'no-cors' });
              if (r) await imageCache.put(new Request(u), r.clone());
            }
          } catch (e) { /* ignore */ }
        }));
      }
    } catch (e) { /* ignore index.json prefetch errors */ }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // delete unexpected caches and remove any video entries if somehow present
    const expected = [CACHE_NAME, IMAGE_CACHE, JSON_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.map(async k => {
      if (!expected.includes(k)) {
        await caches.delete(k);
        return;
      }
      // additionally iterate and remove any cache entries that are video files
      try {
        const c = await caches.open(k);
        const requests = await c.keys();
        await Promise.all(requests.map(async req => {
          try {
            if (VIDEO_RE.test(req.url)) {
              await c.delete(req);
            }
          } catch (e) {}
        }));
      } catch (e) {}
    }));
    await self.clients.claim();
  })());
});

async function showNotificationForPayload(payload) {
  const title = payload.title || 'TF-Stream';
  const options = {
    body: payload.body || '',
    icon: payload.icon || PLACEHOLDER,
    badge: payload.badge || (payload.icon || PLACEHOLDER),
    image: payload.image,
    tag: payload.tag || 'tfstream-auto',
    renotify: false,
    data: payload.data || {},
    actions: payload.actions || []
  };
  try { await self.registration.showNotification(title, options); } catch (e) {}
}

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (!msg) return;
  if (msg.type === 'SHOW_NOTIFICATION') {
    showNotificationForPayload(msg.payload || {});
  } else if (msg.type === 'LIST_CACHES') {
    (async () => {
      const keys = await caches.keys();
      event.source && event.source.postMessage({ type: 'CACHES_LIST', keys });
    })();
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag !== 'tfstream-notifs') return;
  event.waitUntil((async () => {
    // similar to your previous impl: pick a non-poste candidate and notify
    try {
      const jresp = await caches.match('/index.json') || await fetch('/index.json');
      if (!jresp) return;
      const json = await jresp.json();
      const allowed = ['film','série','serie','anime','animé'];
      let pool = [];
      if (Array.isArray(json)) {
        pool = json.filter(it => { if(!it) return false; const c = (it.Catégorie||it.category||'').toString().toLowerCase(); return allowed.includes(c); });
      } else if (typeof json === 'object') {
        pool = Object.values(json).filter(it => { if(!it||typeof it!=='object') return false; const c = (it.Catégorie||it.category||'').toString().toLowerCase(); return allowed.includes(c); });
      }
      let item = null;
      if (pool && pool.length) item = pool[Math.floor(Math.random()*pool.length)];
      else {
        if (Array.isArray(json) && json.length) item = json[Math.floor(Math.random()*json.length)];
        else if (typeof json === 'object') {
          const keys = Object.keys(json||{}); if (keys.length) item = json[keys[Math.floor(Math.random()*keys.length)]];
        }
      }
      const titleBase = item && (item.Titre || item.Name) ? (item.Titre || item.Name).toString().trim() : 'TF-Stream';
      const timeStr = new Date().toLocaleTimeString();
      const body = `${titleBase} ${timeStr}`;
      const image = item && (item['Url Thumb'] || item.thumb) ? new URL(item['Url Thumb'] || item.thumb, self.registration.scope).href : undefined;
      const slug = item && item.__slug ? item.__slug : (titleBase ? titleBase.toString().toLowerCase().replace(/\s+/g,'-') : undefined);
      const dataPayload = { slug };
      await showNotificationForPayload({ title: `TF-Stream vous propose ${titleBase}`, body, image, icon: image || PLACEHOLDER, badge: PLACEHOLDER, tag: 'tfstream-pbg', data: dataPayload });
    } catch (e) { /* ignore */ }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const slug = (event.notification.data && event.notification.data.slug) ? event.notification.data.slug : undefined;
  event.waitUntil((async () => {
    try {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (all && all.length) {
        for (const c of all) {
          try { c.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } }); c.focus(); return; } catch (e) {}
        }
      }
      // open a new window and post message after open
      const url = new URL('/', self.registration.scope).href;
      const opened = await clients.openWindow(url);
      setTimeout(async () => {
        const newClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const nc of newClients) {
          try { nc.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } }); } catch (e) {}
        }
      }, 700);
    } catch (e) {}
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // If request looks like video, do network-only (do NOT cache)
  if (req.destination === 'video' || VIDEO_RE.test(req.url)) {
    event.respondWith((async () => {
      try {
        // prefer fresh network, do not put in cache
        return await fetch(req);
      } catch (e) {
        // fallback to offline page if desired
        return caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // HTML/navigation: network-first, cache fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        // store only if response is safe (not video)
        if (net && (net.ok || net.type === 'opaque')) {
          try {
            const cache = await caches.open(CACHE_NAME);
            // double-check content-type header to avoid caching video
            const ct = net.headers.get('content-type') || '';
            if (!ct.startsWith('video/')) await cache.put(req, net.clone());
          } catch (e) {}
        }
        return net;
      } catch (e) {
        return caches.match(req) || caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Images: cache-first from IMAGE_CACHE
  if (req.destination === 'image' || IMAGE_RE.test(req.url)) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(IMAGE_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) {
          try { await cache.put(req, r.clone()); } catch (e) {}
          return r;
        }
      } catch (e) {}
      return caches.match(PLACEHOLDER);
    })());
    return;
  }

  // JSON metadata: network-first, cache fallback to JSON_CACHE
  if (JSON_RE.test(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(JSON_CACHE);
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) {
          try { await cache.put(req, r.clone()); } catch (e) {}
          return r;
        }
      } catch (e) {}
      const c = await cache.match(req) || caches.match(OFFLINE_URL);
      return c;
    })());
    return;
  }

  // Default: cache-first fallback network, but never cache video-like responses
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(req);
      if (match) return match;
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) {
        const ct = r.headers.get('content-type') || '';
        if (!ct.startsWith('video/')) {
          try { await cache.put(req, r.clone()); } catch (e) {}
        }
        return r;
      }
    } catch (e) {}
    return caches.match(OFFLINE_URL);
  })());
});
