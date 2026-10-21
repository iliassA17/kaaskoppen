const {authenticateUser} = require('../lib/auth.cjs');
const {billingOverview} = require('../lib/billing-overview.cjs');
const {BillingError} = require('../lib/billing.cjs');

function createHandler(loadOverview = billingOverview) { return async function(event) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store'};
  const response = (statusCode, data) => ({statusCode, headers, body: JSON.stringify(data)});
  if (event.httpMethod !== 'POST') return response(405, {error: 'Gebruik POST.'});
  // Expired users must retain access to their own invoices and payment options.
  const identity = await authenticateUser(event);
  if (identity.denied) return {...identity.denied, headers};
  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return response(400, {error: 'Ongeldige aanvraag.'}); }
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => key !== 'after')) {
    return response(400, {error: 'Ongeldige aanvraag.'});
  }
  try { return response(200, await loadOverview(identity, {after: input.after ?? null})); }
  catch (error) {
    return response(error instanceof BillingError ? error.statusCode : 503,
      {error: error instanceof BillingError ? error.message : 'Je abonnement en facturen kunnen tijdelijk niet worden geladen. Probeer opnieuw.'});
  }
}; }
exports.createHandler = createHandler;
exports.handler = createHandler();
