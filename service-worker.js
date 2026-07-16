const CACHE_NAME = 'samara-cache-cf88992add';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './about.html',
  './products.html',
  './privacy.html',
  './terms.html',
  './shipping-refunds.html',
  './404.html',
  './assets/build/styles.406d414b24.min.css',
  './assets/build/app.86abf751f4.min.js',
  './assets/build/page.bab9282d50.min.js',
  './manifest.webmanifest',
  './assets/samara-heritage-logo.jpg',
  './assets/samara-heritage-hero.jpg'
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
    // Always prefer fresh HTML. Serving a cached homepage first can leave visitors
    // running an older navigation script until they reload a second time.
    if (event.request.mode === 'navigate' || event.request.destination === 'document') {
      event.respondWith(
        fetch(event.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            const copy = networkResponse.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
          }
          return networkResponse;
        }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
      );
      return;
    }

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
