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
          // shuffle-like pick but skip 'poste'
          const candidates = json.filter(it => {
            if (!it || typeof it !== 'object') return false;
            const c = (it.Catégorie || it.category || '').toString().toLowerCase();
            return c !== 'poste';
          });
          if (candidates.length) item = candidates[Math.floor(Math.random() * candidates.length)];
        } else if (typeof json === 'object') {
          const arr = Object.values(json).filter(it => {
            if (!it || typeof it !== 'object') return false;
            const c = (it.Catégorie || it.category || '').toString().toLowerCase();
            return c !== 'poste';
          });
          if (arr.length) item = arr[Math.floor(Math.random() * arr.length)];
        }
      }
    } catch (e) { item = null; }
    const title = item && (item.Titre || item.Name) ? (item.Titre || item.Name) : 'TF-Stream — Nouveau contenu';
    const timeStr = (new Date()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const body = timeStr;
    const image = item && (item['Url Thumb'] || item.thumb) ? new URL(item['Url Thumb'] || item.thumb, self.registration.scope).href : undefined;
    const slug = item && item.__slug ? (item.__slug) : undefined;
    const dataPayload = { slug };
    await showNotificationForPayload({ title, body, image, icon: image || PLACEHOLDER, badge: PLACEHOLDER, tag: 'tfstream-pbg', data: dataPayload });
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
          try {
            c.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } });
            c.focus();
            return;
          } catch (e) {}
        }
      }
      try {
        if (slug) {
          const openUrl = new URL('/', self.registration.scope);
          openUrl.searchParams.set('slug', slug);
          await clients.openWindow(openUrl.href);
        } else {
          await clients.openWindow(new URL('/', self.registration.scope).href);
        }
        setTimeout(async () => {
          const newClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const nc of newClients) {
            try { nc.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } }); } catch (e) {}
          }
        }, 700);
      } catch (e) {}
    } catch (e) {}
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
