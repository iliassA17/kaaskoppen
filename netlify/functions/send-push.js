const webpush = require('web-push');

// VAPID configuratie via Netlify environment variables
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_SUBJECT || 'iliass.17@hotmail.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async function(event, context) {
  // Alleen POST toestaan
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS headers
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  var body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige JSON' }) };
  }

  var subscriptions = body.subscriptions || [];
  var payload = JSON.stringify({
    title: body.title || 'Boekingschema',
    body: body.body || '',
    url: body.url || '/',
    tag: body.tag || 'boekingschema',
    icon: body.icon || '/icon-192.png'
  });

  if (subscriptions.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, failed: 0, message: 'Geen abonnees' }) };
  }

  var results = await Promise.allSettled(
    subscriptions.map(function(sub) {
      return webpush.sendNotification(sub, payload).catch(function(err) {
        // 410 = abonnement verlopen/verwijderd
        if (err.statusCode === 410) {
          return { expired: true, endpoint: sub.endpoint };
        }
        throw err;
      });
    })
  );

  var sent = results.filter(function(r) { return r.status === 'fulfilled' && !r.value?.expired; }).length;
  var expired = results.filter(function(r) { return r.status === 'fulfilled' && r.value?.expired; }).length;
  var failed = results.filter(function(r) { return r.status === 'rejected'; }).length;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ sent, expired, failed })
  };
};
