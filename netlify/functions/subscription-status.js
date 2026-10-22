const {authenticateUser} = require('../lib/auth.cjs');
const {subscriptionStatus} = require('../lib/subscriptions.cjs');

exports.handler = async function(event) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
  if (event.httpMethod !== 'POST') return {statusCode: 405, headers, body: JSON.stringify({error: 'Gebruik POST.'})};
  const identity = await authenticateUser(event);
  if (identity.denied) return {...identity.denied, headers};
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return {statusCode: 400, headers, body: JSON.stringify({error: 'Ongeldig controleverzoek.'})}; }
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
      Object.keys(body).some(key => key !== 'refresh') ||
      (Object.hasOwn(body, 'refresh') && typeof body.refresh !== 'boolean')) {
    return {statusCode: 400, headers, body: JSON.stringify({error: 'Ongeldig controleverzoek.'})};
  }
  try {
    let result = await subscriptionStatus(identity, {startTrial: true});
    // Fast startup uses the same server-side Firestore access and expiry checks
    // as product APIs. Expired access still checks Stripe for a late payment.
    if ((!result.allowed || body.refresh !== false) && result.enabled && result.provider === 'stripe' &&
        process.env.STRIPE_SECRET_KEY && process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        await require('../lib/billing.cjs').refreshAccess(identity.user.uid);
        result = await subscriptionStatus(identity);
      } catch {
        // Existing access remains authoritative during a Stripe outage.
        // A paid user can retry; an unavailable provider never grants access.
      }
    }
    return {statusCode: 200, headers, body: JSON.stringify(result)};
  } catch {
    return {statusCode: 503, headers, body: JSON.stringify({error: 'Je toegang kan tijdelijk niet worden gecontroleerd. Probeer opnieuw.'})};
  }
};
