// sw.js
const CACHE_NAME = 'tfstream-static-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // cache optional shell (si vle)
      return cache.addAll([
        '/', 
        '/index.html',
        '/styles.css',
        OFFLINE_URL
      ]).catch(()=>{/* ignore */});
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// helper: is this a video request?
function isVideoRequest(request) {
  try {
    const dest = request.destination;
    if (dest === 'video') return true;
  } catch(e){}
  const url = request.url || '';
  return /\.(mp4|webm|mkv|m3u8|mpd)(\?|$)/i.test(url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Ignore non-GET
  if (req.method !== 'GET') return;

  // If it's a video request -> ALWAYS stream from network and DO NOT cache
  if (isVideoRequest(req)) {
    e.respondWith(
      fetch(req.clone(), { cache: 'no-store', credentials: 'same-origin' })
        .catch(() => {
          // optional fallback: return offline response or a small placeholder
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // For other requests: network-first with cache fallback (example)
  e.respondWith(
    fetch(req).then(networkResponse => {
      // optionally cache some types but avoid caching huge binary assets
      if (networkResponse && networkResponse.status === 200 && req.headers.get('range') === null) {
        const contentType = networkResponse.headers.get('content-type') || '';
        // only cache small-ish text/asset types (js/css/html/json/images)
        if (/^(text\/|application\/javascript|application\/json|image\/)/i.test(contentType)) {
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, networkResponse.clone()); } catch(e){}
          });
        }
      }
      return networkResponse.clone();
    }).catch(() => {
      // fallback to cache
      return caches.match(req).then(cached => cached || caches.match(OFFLINE_URL));
    })
  );
});
