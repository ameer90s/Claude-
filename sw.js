// نسخة 2.0: لا نخزّن طلبات المواقع الخارجية (Finnhub وTwelve Data) — كانت تتخزن كلها وتكبر بلا حد،
// وممكن ترجع أسعار قديمة لو انقطع النت. نخزّن ملفات التطبيق بس (نفس الموقع).
const CACHE_NAME = 'scalping-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache).catch(err => {
        console.log('Cache addAll error:', err);
        return Promise.resolve();
      }))
  );
  self.skipWaiting();
});

// Activate event: يمسح الكاش القديم (scalping-v1 وفيه ردود الـ API المتراكمة)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => n !== CACHE_NAME ? caches.delete(n) : null)))
  );
  self.clients.claim();
});

// Fetch event - Network first, then cache (ملفات التطبيق فقط)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // طلبات الأسعار والشموع تروح للشبكة مباشرة بدون كاش
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200 || response.type === 'error') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)
        .then(r => r || new Response('Not available offline', { status: 503, statusText: 'Service Unavailable' })))
  );
});

// Handle background sync للتنبيهات
self.addEventListener('sync', event => {
  if (event.tag === 'sync-alerts') event.waitUntil(Promise.resolve());
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
  event.waitUntil(self.registration.showNotification('توصية تداول جديدة', options));
});

// Notification click: يفتح التطبيق (أو يركّز عليه لو مفتوح)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
