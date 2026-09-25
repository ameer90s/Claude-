const CACHE_NAME = 'scalping-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js'
];

// Install event
self.addEventListener('install', event => {
  console.log('Service Worker Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache).catch(err => {
          console.log('Cache addAll error:', err);
          // يعمل بدون أخطاء حتى لو بعض الملفات غير موجودة
          return Promise.resolve();
        });
      })
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
  console.log('Service Worker Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Network first, then cache
self.addEventListener('fetch', event => {
  // لا نتعامل مع POST requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    // جرب من الشبكة أولاً
    fetch(event.request)
      .then(response => {
        // إذا كانت الشبكة جيدة، احفظ في الـ cache
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // احفظ نسخة في الـ cache
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // إذا فشل من الشبكة، جرب من الـ cache
        return caches.match(event.request)
          .then(response => {
            return response || new Response(
              'Not available offline',
              { status: 503, statusText: 'Service Unavailable' }
            );
          });
      })
  );
});

// Handle background sync للتنبيهات
self.addEventListener('sync', event => {
  if (event.tag === 'sync-alerts') {
    event.waitUntil(
      // يمكن إضافة logic للتنبيهات هنا
      Promise.resolve()
    );
  }
});

// Push notifications
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'توصية جديدة',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23667eea" width="192" height="192"/><text x="96" y="96" font-size="60" fill="%23fff" text-anchor="middle" dy=".3em">🎯</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23667eea" width="192" height="192"/><text x="96" y="96" font-size="60" fill="%23fff" text-anchor="middle" dy=".3em">📊</text></svg>',
    vibrate: [200, 100, 200],
    tag: 'scalping-alert',
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification('توصية تداول جديدة', options)
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
