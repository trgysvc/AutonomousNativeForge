import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({url}) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
  new StaleWhileRevalidate({
    cacheName: 'api-cache',
    plugins: [
      new CacheableResponsePlugin({statuses: [0, 200]})
    ]
  })
);

const bgSyncPlugin = new BackgroundSyncPlugin('post-bg-sync', {
  maxRetentionTime: 24 * 60
});

registerRoute(
  ({url, method}) => method === 'POST' && url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'post-api-cache',
    plugins: [bgSyncPlugin]
  }),
  'POST'
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});