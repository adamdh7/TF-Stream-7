const CACHE_NAME = 'tfstream-shell-v1';
const IMAGE_CACHE = 'tfstream-thumbs-v1';
const JSON_CACHE = 'tfstream-json-v1';
const VIDEO_CACHE = 'tfstream-videos-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/styles.css',
  '/main.js',
  '/images/placeholder-thumb.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);

    // Eseye telechaje index.json (si egziste) epi cache JSON + thumbs kle
    try {
      const resp = await fetch('/index.json');
      if (resp.ok) {
        const index = await resp.json();
        const urlsToCache = [];

        // adapte selon estrikti index.json ou; eg: index ka gen fichye .json oswa items
        if (Array.isArray(index)) {
          index.forEach(it => {
            if (it['Url Thumb']) urlsToCache.push(it['Url Thumb']);
            if (it.video) urlsToCache.push(it.video);
          });
        } else {
          // si index se obj ki gen lis JSON
          Object.values(index).forEach(v => {
            if (typeof v === 'string' && v.endsWith('.json')) urlsToCache.push(v);
          });
        }

        // add only JSON & thumbs (pa oblije ajoute gwo videyo la)
        await Promise.all(urlsToCache.map(u => {
          // pwan sèlman jpg/png/webp oswa .json pou kounye a
          if (/\.(jpg|jpeg|png|webp)$/.test(u) || u.endsWith('.json')) {
            return cache.add(u).catch(()=>{});
          }
          return Promise.resolve();
        }));
      }
    } catch (e) {
      // ignore fetch errors — enstalasyon pa pral echwe
      console.warn('Index.json fetch failed at install:', e);
    }

    return self.skipWaiting();
  })());
});
