const Stripe = require('stripe');
const {processEvent, BillingError} = require('../lib/billing.cjs');
function createHandler(handleEvent = processEvent) { return async function(event) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
  const response = (statusCode, data) => ({statusCode, headers, body: JSON.stringify(data)});
  if (event.httpMethod !== 'POST') return response(405, {error: 'Gebruik POST.'});
  if (!process.env.STRIPE_WEBHOOK_SECRET) return response(503, {error: 'Webhook is nog niet ingesteld.'});
  let verified;
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body || '';
    verified = new Stripe('sk_test_signature_verification').webhooks.constructEvent(body,
      event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch { return response(400, {error: 'Ongeldige Stripe-handtekening.'}); }
  try { return response(200, await handleEvent(verified)); }
  catch (error) {
    return response(error instanceof BillingError && error.statusCode === 400 ? 400 : 503,
      {error: 'De betaling kon nog niet worden verwerkt. Stripe kan het bericht opnieuw aanbieden.'});
  }
}; }
exports.createHandler = createHandler;
exports.handler = createHandler();
