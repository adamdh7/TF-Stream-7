const SW_VERSION = 'tfstream-v1.0.9';
const CACHE_NAME = `${SW_VERSION}-static`;
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/asset/192.png',
  '/index.json'
];
const NOTIF_DB_NAME = 'tfstream-notifs-db';
const NOTIF_STORE = 'notifications';
function openNotifDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIF_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTIF_STORE)) {
        const store = db.createObjectStore(NOTIF_STORE, { keyPath: 'id' });
        store.createIndex('sent', 'sent', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveQueuedNotification(payload) {
  try {
    const db = await openNotifDb();
    const tx = db.transaction(NOTIF_STORE, 'readwrite');
    const store = tx.objectStore(NOTIF_STORE);
    const id = payload && payload.data && payload.data.slug ? `slug:${payload.data.slug}` : `auto:${Date.now()}-${Math.random()}`;
    const toSave = Object.assign({ id, created: Date.now(), sent: false }, payload || {});
    store.put(toSave);
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }).catch(()=>{});
    db.close();
    return toSave;
  } catch (e) {
    return null;
  }
}
async function pickNextQueuedNotification() {
  try {
    const db = await openNotifDb();
    const tx = db.transaction(NOTIF_STORE, 'readonly');
    const store = tx.objectStore(NOTIF_STORE);
    return new Promise((resolve) => {
      const req = store.openCursor();
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) {
          resolve(null);
          db.close();
          return;
        }
        if (!cur.value.sent) {
          resolve(cur.value);
          db.close();
          return;
        }
        cur.continue();
      };
      req.onerror = () => { resolve(null); db.close(); };
    });
  } catch (e) {
    return null;
  }
}
async function markNotifAsSent(id) {
  try {
    const db = await openNotifDb();
    const tx = db.transaction(NOTIF_STORE, 'readwrite');
    const store = tx.objectStore(NOTIF_STORE);
    const rec = await new Promise((res) => {
      const r = store.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (rec) {
      rec.sent = Date.now();
      store.put(rec);
    }
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }).catch(()=>{});
    db.close();
  } catch (e) {}
}
async function getAllQueued() {
  try {
    const db = await openNotifDb();
    const tx = db.transaction(NOTIF_STORE, 'readonly');
    const store = tx.objectStore(NOTIF_STORE);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => { resolve(req.result || []); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  } catch (e) { return []; }
}
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(()=>{}))
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (!k.startsWith(SW_VERSION)) {
        return caches.delete(k);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && response.ok) {
        const url = new URL(event.request.url);
        const ct = response.headers.get('content-type') || '';
        if (url.origin === location.origin && !/video|audio|font/i.test(ct)) {
          cache.put(event.request, response.clone()).catch(()=>{});
        }
      }
      return response;
    } catch (err) {
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('/index.html');
        if (fallback) return fallback;
      }
      return new Response('', { status: 504, statusText: 'Network error' });
    }
  })());
});
async function showNotification(payload) {
  try {
    const title = payload && payload.title ? payload.title : 'TF-Stream';
    const options = {
      body: payload && payload.body ? payload.body : '',
      icon: (payload && payload.icon) || (payload && payload.image) || '/asset/192.png',
      image: payload && payload.image ? payload.image : undefined,
      badge: (payload && payload.badge) || '/asset/192.png',
      tag: (payload && payload.tag) || (`tfstream-${(payload && payload.data && payload.data.slug) || Date.now()}`),
      data: (payload && payload.data) || {},
      renotify: false,
      requireInteraction: false
    };
    await self.registration.showNotification(title, options);
    return true;
  } catch (e) {
    return false;
  }
}
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tfstream-notifs') {
    event.waitUntil(processNotificationQueue());
  }
});
self.addEventListener('sync', (event) => {
  if (event.tag === 'tfstream-notifs') {
    event.waitUntil(processNotificationQueue());
  }
});
async function processNotificationQueue() {
  try {
    const queued = await getAllQueued();
    if (!queued || queued.length === 0) return;
    for (const next of queued) {
      try {
        if (next.sent) continue;
        const payload = {
          title: next.title,
          body: next.body,
          image: next.image,
          icon: next.icon,
          badge: next.badge,
          tag: next.tag,
          data: next.data || {}
        };
        const ok = await showNotification(payload);
        if (ok) {
          await markNotifAsSent(next.id);
          const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
          clientsList.forEach(c => {
            try { c.postMessage({ type: 'NOTIFICATION_SHOWN', payload }); } catch (e) {}
          });
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) {}
}
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { title: 'TF-Stream', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    await showNotification(payload);
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const slug = data.slug || (data && data.slug);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = all.find(c => c.url && new URL(c.url).origin === location.origin);
    if (client) {
      try {
        client.focus();
        client.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } });
      } catch (e) {}
    } else {
      const openUrl = slug ? `/${slug}` : '/';
      try {
        const newClient = await self.clients.openWindow(openUrl);
        if (newClient) {
          newClient.postMessage({ type: 'NOTIFICATION_CLICK', payload: { slug } });
        }
      } catch (e) {}
    }
  })());
});
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ENQUEUE_NOTIFICATION':
      (async () => {
        await saveQueuedNotification(msg.payload || {});
        try { await processNotificationQueue(); } catch (e) {}
      })();
      break;
    case 'SHOW_NOTIFICATION':
      (async () => {
        const ok = await showNotification(msg.payload || {});
        try {
          event.source && event.source.postMessage && event.source.postMessage({ type: 'SHOW_NOTIFICATION_RESULT', ok: !!ok, payload: msg.payload || {} });
          if (ok && msg.payload && msg.payload.data && msg.payload.data.slug) {
            const id = `slug:${msg.payload.data.slug}`;
            await markNotifAsSent(id);
            const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            allClients.forEach(c => { try { c.postMessage({ type: 'NOTIFICATION_SHOWN', payload: msg.payload }); } catch (e) {} });
          }
        } catch (e) {}
      })();
      break;
    default:
      break;
  }
});
async function tryRegisterPeriodicSync() {
  try {
    const reg = self.registration;
    if (!('periodicSync' in reg)) return;
    await reg.periodicSync.register('tfstream-notifs', { minInterval: 2 * 60 * 1000 });
  } catch (e) {}
}
tryRegisterPeriodicSync();
self.addEventListener('notificationclose', () => {});
