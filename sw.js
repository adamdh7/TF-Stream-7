const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
const OFFLINE_URL = '/offline.html';
const PLACEHOLDER = '/asset/192.png';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json', OFFLINE_URL, PLACEHOLDER];
const VIDEO_REGEX = /\.(mp4|m3u8|webm|mpd|mkv)(\?|$)/i;
const IMAGE_REGEX = /\.(png|jpg|jpeg|webp|gif)(\?|$)/i;
function openNotifDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tfstream-notifs', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function enqueueNotificationToDB(payload){
  const db = await openNotifDB();
  const tx = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  store.add({ payload, created: Date.now() });
  return new Promise((res, rej) => {
    tx.oncomplete = () => { db.close(); res(true); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
async function getQueuedNotifications(){
  const db = await openNotifDB();
  const tx = db.transaction('queue', 'readonly');
  const store = tx.objectStore('queue');
  return new Promise((res, rej) => {
    const rq = store.getAll();
    rq.onsuccess = () => { db.close(); res(rq.result || []); };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}
async function clearQueued(ids){
  if(!Array.isArray(ids) || ids.length===0) return;
  const db = await openNotifDB();
  const tx = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  ids.forEach(id => store.delete(id));
  return new Promise((res, rej) => {
    tx.oncomplete = () => { db.close(); res(true); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(PRECACHE_URLS.map(async u => {
        try {
          const res = await fetch(u, { cache: 'no-cache' });
          if (res && (res.ok || res.type === 'opaque')) await cache.put(new Request(u), res.clone());
        } catch (e) {
        }
      }));
    } catch (e) {}
    try {
      const resp = await fetch('/index.json', { cache: 'no-cache' });
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const json = await resp.clone().json().catch(()=>null);
        const imageCache = await caches.open(IMAGE_CACHE);
        const jsonCache = await caches.open(JSON_CACHE);
        try { await jsonCache.put(new Request('/index.json'), resp.clone()); } catch(e){}
        const urls = new Set();
        function collectFromItem(it){
          if(!it || typeof it !== 'object') return;
          if (it['Url Thumb'] && typeof it['Url Thumb'] === 'string') urls.add(new URL(it['Url Thumb'], self.registration.scope).href);
          if (it.thumb && typeof it.thumb === 'string') urls.add(new URL(it.thumb, self.registration.scope).href);
          if (it.info && typeof it.info === 'string' && it.info.endsWith('.json')) urls.add(new URL(it.info, self.registration.scope).href);
          if (Array.isArray(it.Saisons)) {
            it.Saisons.forEach(s => {
              if(!s || typeof s !== 'object') return;
              if (s.description && typeof s.description === 'string' && s.description.endsWith('.json')) urls.add(new URL(s.description, self.registration.scope).href);
              if (Array.isArray(s.episodes)) {
                s.episodes.forEach(ep => {
                  if(!ep || typeof ep !== 'object') return;
                  if (ep.thumbnail && typeof ep.thumbnail === 'string') urls.add(new URL(ep.thumbnail, self.registration.scope).href);
                  if (ep.thumb && typeof ep.thumb === 'string') urls.add(new URL(ep.thumb, self.registration.scope).href);
                });
              }
            });
          }
        }
        if (Array.isArray(json)) {
          json.forEach(it => collectFromItem(it));
        } else if (typeof json === 'object' && json !== null) {
          Object.values(json).forEach(v => {
            if (typeof v === 'object') collectFromItem(v);
            else if (typeof v === 'string') {
              try {
                const u = new URL(v, self.registration.scope).href;
                if (IMAGE_REGEX.test(u) || v.endsWith('.json')) urls.add(u);
              } catch(e){}
            }
          });
        }
        await Promise.all(Array.from(urls).map(async u => {
          try {
            if (VIDEO_REGEX.test(u)) return;
            if (u.endsWith('.json')) {
              const r = await fetch(u, { cache: 'no-cache' });
              if (r && (r.ok || r.type === 'opaque')) await jsonCache.put(new Request(u), r.clone());
            } else if (IMAGE_REGEX.test(u)) {
              const r = await fetch(u, { mode: 'no-cors' }).catch(()=>null);
              if (r) {
                try { await imageCache.put(new Request(u), r.clone()); } catch(e){}
              }
            }
          } catch (e) {}
        }));
      }
    } catch (e) {
    }
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
  } else if (msg.type === 'ENQUEUE_NOTIFICATION') {
    (async () => {
      try {
        await enqueueNotificationToDB(msg.payload || {});
        try { event.source && event.source.postMessage({ type: 'ENQUEUE_OK' }); } catch(e){}
      } catch (err) {
        try { event.source && event.source.postMessage({ type: 'ENQUEUE_ERROR', error: String(err) }); } catch(e){}
      }
    })();
  }
});
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'tfstream-notifs') return;
  event.waitUntil((async () => {
    try {
      const queued = await getQueuedNotifications();
      if (queued && queued.length) {
        for (const q of queued) {
          try { await showNotificationForPayload(q.payload || {}); } catch(e){}
        }
        const ids = queued.map(q => q.id).filter(Boolean);
        try { await clearQueued(ids); } catch(e){}
        return;
      }
    } catch (e) {}
    let item = null;
    try {
      const jresp = await caches.match('/index.json') || await fetch('/index.json');
      if (jresp) {
        const json = await jresp.json();
        const allowed = ['film','série','serie','anime','animé'];
        let pool = [];
        if (Array.isArray(json)) {
          pool = json.filter(it => { if(!it) return false; const c = (it.Catégorie||it.category||'').toString().toLowerCase(); return allowed.includes(c); });
        } else if (typeof json === 'object') {
          pool = Object.values(json).filter(it => { if(!it||typeof it!=='object') return false; const c = (it.Catégorie||it.category||'').toString().toLowerCase(); return allowed.includes(c); });
        }
        if (pool && pool.length) {
          item = pool[Math.floor(Math.random() * pool.length)];
        } else {
          if (Array.isArray(json) && json.length) item = json[Math.floor(Math.random() * json.length)];
          else if (typeof json === 'object') {
            const keys = Object.keys(json||{}); if (keys.length) item = json[keys[Math.floor(Math.random()*keys.length)]];
          }
        }
      }
    } catch (e) { item = null; }
    const titleBase = item && (item.Titre || item.Name) ? (item.Titre || item.Name).toString().trim() : 'TF-Stream';
    const templates = [
      'TF-Stream vous propose ' + titleBase,
      'Qu\\'avez-vous pensé de ' + titleBase + ' ?'
    ];
    const body = (item && (item.Description||item.Bio)) ? (item.Description||item.Bio).slice(0,120) : templates[Math.floor(Math.random()*templates.length)];
    const image = item && (item['Url Thumb'] || item.thumb) ? new URL(item['Url Thumb'] || item.thumb, self.registration.scope).href : undefined;
    const slug = item && item.__slug ? item.__slug : (titleBase ? titleBase.toString().toLowerCase().replace(/\s+/g,'-') : undefined);
    const dataPayload = { slug };
    await showNotificationForPayload({ title: `TF-Stream vous propose ${titleBase}`, body, image, icon: image || PLACEHOLDER, badge: PLACEHOLDER, tag: 'tfstream-pbg', data: dataPayload });
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
          const url = new URL('/' + slug, self.registration.scope).href;
          await clients.openWindow(url);
        } else {
          const url = new URL('/', self.registration.scope).href;
          await clients.openWindow(url);
        }
      } catch (e) {}
    } catch (e) {}
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  try {
    const url = new URL(req.url);
    if (VIDEO_REGEX.test(url.pathname)) {
      return;
    }
  } catch (e) {
  }
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
  if (req.destination === 'image' || IMAGE_REGEX.test(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) {
          try { await cache.put(req, resp.clone()); } catch(e) {}
          return resp;
        }
      } catch (e) {}
      return caches.match(PLACEHOLDER) || Response.error();
    })());
    return;
  }
  if (req.url.endsWith('.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(JSON_CACHE);
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) { try { await cache.put(req, r.clone()); } catch(e){}; return r; }
      } catch (e) {}
      const c = await cache.match(req) || caches.match(OFFLINE_URL);
      return c;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(req);
    if (match) return match;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) {
        try { await cache.put(req, r.clone()); } catch(e) {}
        return r;
      }
    } catch (e) {
      return caches.match(OFFLINE_URL);
    }
    return caches.match(OFFLINE_URL);
  })());
});
