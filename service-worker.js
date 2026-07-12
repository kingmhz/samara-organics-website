const CACHE_NAME = 'samara-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './about.html',
  './products.html',
  './styles.css',
  './script.js',
  './page.js',
  './manifest.webmanifest',
  './assets/samara-buffalo-logo.webp',
  './assets/samara-dahi-bowl.webp',
  './assets/samara-delaval-milking.webp',
  './assets/samara-ghee-jar.webp',
  './assets/samara-milk-bottle.webp',
  './assets/samara-hero-3d-wide.webp',
  './assets/samara-mark.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request);
      })
    );
  }
});
