// Service Worker — Boekingschema Push Notificaties
function appTarget(value) {
  try {
    var target = new URL(value || '/app/', self.location.origin);
    if (target.origin !== self.location.origin) return self.location.origin + '/app/';
    if (target.pathname === '/' || target.pathname === '/boekingen.html') target.pathname = '/app/';
    return target.pathname.indexOf('/app/') === 0 ? target.href : self.location.origin + '/app/';
  } catch (_) { return self.location.origin + '/app/'; }
}

// Push ontvangen
self.addEventListener('push', function(event) {
  var data = {};
  if (event.data) {
    try { data = event.data.json(); } catch(e) { data = { title: 'Boekingschema', body: event.data.text() }; }
  }

  var title = data.title || 'Boekingschema';
  var options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'boekingschema',
    renotify: true,
    data: { url: appTarget(data.url) },
    vibrate: [200, 100, 200],
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Klik op notificatie → open app op juiste pagina
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = appTarget(event.notification.data && event.notification.data.url);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Als de app al open is, focus dan die tab en stuur bericht
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (new URL(client.url).origin === self.location.origin &&
            new URL(client.url).pathname.indexOf('/app/') === 0 && 'focus' in client) {
          return client.focus().then(function() {
            client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          });
        }
      }
      // Anders: open nieuw tabblad
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Activeer meteen (skip waiting)
self.addEventListener('install', function(event) {
  self.skipWaiting();
});
self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});
