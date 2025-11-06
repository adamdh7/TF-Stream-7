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

    // Pre-cache thumbnails / referenced jsons from index.json if available
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const json = await resp.clone().json();
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);
        const urls = new Set();

        if (Array.isArray(json)) {
          json.forEach(it => {
            if (!it || typeof it !== 'object') return;
            if (it['Url Thumb']) urls.add(new URL(it['Url Thumb'], self.registration.scope).href);
            if (it.thumb) urls.add(new URL(it.thumb, self.registration.scope).href);
            if (it.info && typeof it.info === 'string' && it.info.endsWith('.json')) urls.add(new URL(it.info, self.registration.scope).href);
            if (Array.isArray(it.Saisons)) {
              it.Saisons.forEach(s => {
                if (!s || typeof s !== 'object') return;
                if (s.description && typeof s.description === 'string' && s.description.endsWith('.json'))
                  urls.add(new URL(s.description, self.registration.scope).href);
                if (Array.isArray(s.episodes)) {
                  s.episodes.forEach(ep => {
                    if (!ep || typeof ep !== 'object') return;
                    if (ep.thumbnail) urls.add(new URL(ep.thumbnail, self.registration.scope).href);
                    if (ep.thumb) urls.add(new URL(ep.thumb, self.registration.scope).href);
                    if (ep.video && typeof ep.video === 'string' && ep.video.endsWith('.json'))
                      urls.add(new URL(ep.video, self.registration.scope).href);
                  });
                }
              });
            }
          });
        } else if (typeof json === 'object') {
          Object.values(json).forEach(v => {
            if (typeof v === 'string' && (v.endsWith('.json') || /\.(jpg|jpeg|png|webp|gif)$/i.test(v)))
              urls.add(new URL(v, self.registration.scope).href);
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
              // try no-cors for some external images
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

async function showNotificationForPayload(payload = {}) {
  const title = payload.title || 'TF-Stream';
  // determine data.url from payload.data.url or payload.data.slug
  let data = payload.data || {};
  if (data && !data.url && data.slug) {
    try {
      data.url = new URL('/' + data.slug, self.registration.scope).href;
    } catch (e) {
      data.url = new URL('/Accueil', self.registration.scope).href;
    }
  } else if (!data || !data.url) {
    data = Object.assign({}, data, { url: new URL('/Accueil', self.registration.scope).href });
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || PLACEHOLDER,
    badge: payload.badge || (payload.icon || PLACEHOLDER),
    image: payload.image,
    tag: payload.tag || 'tfstream-auto',
    renotify: false,
    data: data,
    actions: payload.actions || []
  };

  try {
    await self.registration.showNotification(title, options);
  } catch (e) {}
}

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (!msg) return;
  if (msg.type === 'SHOW_NOTIFICATION') {
    // payload expected to have payload.data.url or payload.data.slug
    showNotificationForPayload(msg.payload || {});
  } else if (msg.type === 'LIST_CACHES') {
    (async () => {
      const keys = await caches.keys();
      event.source && event.source.postMessage({ type: 'CACHES_LIST', keys });
    })();
  }
});

// Periodic sync - pick only film/serie/anime (exclude postes)
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'tfstream-notifs') return;
  event.waitUntil((async () => {
    let item = null;
    try {
      const jresp = await caches.match('/index.json') || await fetch('/index.json');
      if (!jresp) throw new Error('no index.json');
      const json = await jresp.json();

      const pickCandidate = arr => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        // filter to exclude posts
        const candidates = arr.filter(it => {
          if (!it || typeof it !== 'object') return false;
          const c = (it.Catégorie || it.category || '').toString().toLowerCase();
          return c === 'film' || c === 'série' || c === 'serie' || c === 'anime' || c === 'animé' || c === 'anim';
        });
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
      };

      if (Array.isArray(json)) {
        item = pickCandidate(json);
        // fallback: if none matched (e.g., categories missing) try any non-post
        if (!item) {
          const nonPosts = json.filter(it => {
            const c = (it && (it.Catégorie || it.category || '')).toString().toLowerCase();
            return c !== 'poste';
          });
          if (nonPosts.length) item = nonPosts[Math.floor(Math.random() * nonPosts.length)];
        }
      } else if (typeof json === 'object') {
        const list = Object.keys(json).map(k => json[k]).filter(Boolean);
        item = pickCandidate(list) || (list.length ? list[Math.floor(Math.random() * list.length)] : null);
      }

      // If still null, try to fetch sub-json items from index content
      if (!item && Array.isArray(json) && json.length) {
        const raw = json[Math.floor(Math.random() * json.length)];
        if (typeof raw === 'string') {
          try {
            const sub = await fetch(new URL(raw, self.registration.scope).href);
            if (sub && sub.ok) {
              const subJson = await sub.json();
              if (Array.isArray(subJson)) item = pickCandidate(subJson) || subJson[Math.floor(Math.random() * subJson.length)];
              else if (typeof subJson === 'object') item = subJson;
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      item = null;
    }

    const title = item && (item.Titre || item.Name) ? `TF-Stream vous propose ${item.Titre || item.Name}` : 'TF-Stream — Nouveau contenu';
    const body = item && (item.Description || item.Bio) ? (String(item.Description || item.Bio).slice(0, 120)) : 'Cliquez pour découvrir.';
    const image = item && (item['Url Thumb'] || item.thumb) ? new URL(item['Url Thumb'] || item.thumb, self.registration.scope).href : undefined;
    const dataUrl = item && item.__slug ? new URL('/' + item.__slug, self.registration.scope).href : new URL('/Accueil', self.registration.scope).href;

    await showNotificationForPayload({
      title,
      body,
      image,
      icon: image || PLACEHOLDER,
      badge: PLACEHOLDER,
      tag: 'tfstream-pbg',
      data: { url: dataUrl, slug: item && item.__slug ? item.__slug : undefined }
    });
  })());
});

// Notification click: if any client visible -> don't navigate (just focus). If no client -> openWindow(url)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const payloadData = event.notification.data || {};
  const url = payloadData.url || (payloadData.slug ? new URL('/' + payloadData.slug, self.registration.scope).href : new URL('/Accueil', self.registration.scope).href);

  event.waitUntil((async () => {
    try {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

      // If there is at least one visible client, focus it and DO NOT navigate to the notif URL.
      // This respects the user's request: clicking notif when app open => just close / focus, no redirect.
      const visibleClient = allClients.find(c => c.visibilityState === 'visible');
      if (visibleClient) {
        try { visibleClient.focus(); } catch (e) {}
        return;
      }

      // If there are clients open but none visible, focus the first (still avoid forcing navigation)
      if (allClients.length > 0) {
        try { allClients[0].focus(); } catch (e) {}
        return;
      }

      // No clients open -> open new window/tab with the target URL
      try { await clients.openWindow(url); } catch (e) {}
    } catch (e) {
      // fallback open window anyway
      try { await clients.openWindow(url); } catch (err) {}
    }
  })());
});

self.addEventListener('notificationclose', event => {
  // optional: you can handle analytics here if desired
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // navigation (HTML)
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

  // images (thumbs)
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif)$/i.test(url)) {
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

  // json resources
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

  // video / stream direct passthrough
  if (/\.(mp4|m3u8|webm|mpd|mkv)$/i.test(url)) {
    event.respondWith((async () => {
      try { return await fetch(req); } catch (e) { return caches.match(OFFLINE_URL); }
    })());
    return;
  }

  // fallback to cache-first for other assets
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
