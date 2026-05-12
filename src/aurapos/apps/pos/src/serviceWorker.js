import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

const CACHE_NAMES = {
  API: 'api-cache-v1',
  IMAGE: 'image-cache-v1',
  OFFLINE: 'offline-cache-v1'
};

precacheAndRoute(self.__WB_MANIFEST);

// API routes: network first
registerRoute(
  ({ url, event }) => {
    if (url.origin !== self.location.origin) return false;
    return url.pathname.startsWith('/api');
  },
  new NetworkFirst({
    cacheName: CACHE_NAMES.API,
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 60, // 1 hour
      }),
    ]
  })
);

// Image routes: cache first
registerRoute(
  ({ url, event }) => {
    if (url.origin !== self.location.origin) return false;
    return url.pathname.match(/\.(?:png|jpg|jpeg|svg|gif)$/i);
  },
  new CacheFirst({
    cacheName: CACHE_NAMES.IMAGE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ]
  })
);

// Navigation routes: network only, but fallback to offline.html on failure
registerRoute(
  ({ url, event }) => {
    if (url.origin !== self.location.origin) return false;
    return url.pathname.startsWith('/');
  },
  new NetworkOnly()
).setCatchHandler(({ event }) => {
  return caches.match('/offline.html');
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(
            (name) =>
              !Object.values(CACHE_NAMES).includes(name) &&
              !name.startsWith('workbox-')
          )
          .map((name) => caches.delete(name))
      );
    })
  );
  event.waitUntil(self.clientsClaim());
});