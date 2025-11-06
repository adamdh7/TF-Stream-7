const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
const OFFLINE_URL = '/offline.html';
const PLACEHOLDER = '/asset/192.png';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json', OFFLINE_URL, PLACEHOLDER];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async u => {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(new Request(u), res.clone());
      } catch (e) {}
    }));
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const json = await resp.clone().json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);
        const urls = new Set();
        if (Array.isArray(json)) {
          json.forEach(it => {
            if (it && typeof it === 'object') {
              if (it['Url Thumb']) urls.add(new URL(it['Url Thumb'], self.registration.scope).href);
              if (it.thumb) urls.add(new URL(it.thumb, self.registration.scope).href);
              if (it.info && typeof it.info === 'string' && it.info.endsWith('.json')) urls.add(new URL(it.info, self.registration.scope).href);
              if (Array.isArray(it.Saisons)) {
                it.Saisons.forEach(s => {
                  if (s && typeof s === 'object') {
                    if (s.description && typeof s.description === 'string' && s.description.endsWith('.json')) urls.add(new URL(s.description, self.registration.scope).href);
                    if (Array.isArray(s.episodes)) {
                      s.episodes.forEach(ep => {
                        if (ep && typeof ep === 'object') {
                          if (ep.thumbnail) urls.add(new URL(ep.thumbnail, self.registration.scope).href);
                          if (ep.thumb) urls.add(new URL(ep.thumb, self.registration.scope).href);
                          if (ep.video && typeof ep.video === 'string' && ep.video.endsWith('.json')) urls.add(new URL(ep.video, self.registration.scope).href);
                        }
                      });
                    }
                  }
                });
              }
            }
          });
        } else if (typeof json === 'object') {
          Object.values(json).forEach(v => {
            if (typeof v === 'string' && (v.endsWith('.json') || /\.(jpg|jpeg|png|webp|gif)$/i.test(v))) urls.add(new URL(v, self.registration.scope).href);
            else if (v && typeof v === 'object') {
              if (v['Url Thumb']) urls.add(new URL(v['Url Thumb'], self.registration.scope).href);
              if (v.thumb) urls.add(new URL(v.thumb, self.registration.scope).href);
            }
          });
        }
        await Promise.all(Array.from(urls).map(async u => {
          try {
            if (u.endsWith('.json')) {
              const r = await fetch(u, { cache: 'no-cache' });
              if (r && (r.ok || r.type === 'opaque')) await jsonCache.put(new Request(u), r.clone());
            } else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) {
              const r = await fetch(u, { mode: 'no-cors' });
              if (r) await imageCache.put(new Request(u), r.clone());
            }
          } catch (e) {}
        }));
      }
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const expected = [CACHE_NAME, IMAGE_CACHE, JSON_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.map(k => expected.includes(k) ? Promise.resolve() : caches.delete(k)));
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
    let item = null;
    try {
      const jresp = await caches.match('/index.json') || await fetch('/index.json');
      if (jresp) {
        const json = await jresp.json();
        if (Array.isArray(json) && json.length) {
          const candidate = json[Math.floor(Math.random() * json.length)];
          if (candidate && typeof candidate === 'object') item = candidate;
          else if (typeof candidate === 'string') {
            try {
              const sub = await fetch(new URL(candidate, self.registration.scope).href);
              if (sub && sub.ok) {
                const subJson = await sub.json();
                if (Array.isArray(subJson)) item = subJson[Math.floor(Math.random() * subJson.length)];
                else if (typeof subJson === 'object') item = subJson;
              }
            } catch (e) {}
          }
        } else if (typeof json === 'object') {
          const keys = Object.keys(json || {});
          if (keys.length) {
            const k = keys[Math.floor(Math.random() * keys.length)];
            item = json[k];
          }
        }
      }
    } catch (e) { item = null; }
    const title = item && (item.Titre || item.Name) ? `TF-Stream vous propose ${item.Titre || item.Name}` : 'TF-Stream — Nouveau contenu';
    const body = item && (item.Description || item.Bio) ? (item.Description || item.Bio).slice(0, 120) : 'Cliquez pour découvrir.';
    const image = item && (item['Url Thumb'] || item.thumb) ? new URL(item['Url Thumb'] || item.thumb, self.registration.scope).href : undefined;
    const dataUrl = item && item.__slug ? new URL('/' + item.__slug, self.registration.scope).href : new URL('/Accueil', self.registration.scope).href;
    await showNotificationForPayload({ title, body, image, icon: image || PLACEHOLDER, badge: PLACEHOLDER, tag: 'tfstream-pbg', data: { url: dataUrl } });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/Accueil';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const cu = new URL(c.url);
        const tu = new URL(url, self.registration.scope);
        if (cu.origin === tu.origin) {
          try { await c.navigate(tu.pathname + tu.search + tu.hash); } catch (e) {}
          c.focus();
          return;
        }
      } catch (e) {}
    }
    try { await clients.openWindow(url); } catch (e) {}
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        if (net && (net.ok || net.type === 'opaque')) cache.put(req, net.clone());
        return net;
      } catch (e) {
        return caches.match(req) || caches.match(OFFLINE_URL);
      }
    })());
    return;
  }
  const url = req.url;
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif)$/.test(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) { cache.put(req, r.clone()); return r; }
      } catch (e) {}
      return caches.match(PLACEHOLDER);
    })());
    return;
  }
  if (url.endsWith('.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(JSON_CACHE);
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) { cache.put(req, r.clone()); return r; }
      } catch (e) {}
      const c = await cache.match(req) || caches.match(OFFLINE_URL);
      return c;
    })());
    return;
  }
  if (/\.(mp4|m3u8|webm|mpd|mkv)$/i.test(url)) {
    event.respondWith((async () => {
      try { return await fetch(req); } catch (e) { return caches.match(OFFLINE_URL); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(req);
    if (match) return match;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
      return r;
    } catch (e) {
      return caches.match(OFFLINE_URL);
    }
  })());
});
