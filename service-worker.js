const CACHE_NAME = 'samara-cache-1f960df787';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './about.html',
  './products.html',
  './privacy.html',
  './terms.html',
  './shipping-refunds.html',
  './404.html',
  './assets/build/styles.1f960df787.min.css',
  './assets/build/farm-tour.93ac46f8cd.min.js',
  './assets/build/subscription-booking.b9c30c40c8.min.js',
  './assets/build/commerce.a8dafebf01.min.js',
  './assets/build/app.43304e4c80.min.js',
  './assets/build/page.6b84868602.min.js',
  './assets/build/tracking.b25d6ba97b.min.js',
  './assets/build/support.7e78d7fc41.min.js',
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
  const privatePaths = new Set(['/track.html', '/support.html', '/manage-subscription.html', '/admin.html']);

  if (url.origin === self.location.origin && event.request.method === 'GET' && !url.pathname.startsWith('/api/') && !privatePaths.has(url.pathname)) {
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
