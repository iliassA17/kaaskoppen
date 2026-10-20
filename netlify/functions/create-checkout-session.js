const {authenticateUser} = require('../lib/auth.cjs');
const {createCheckout, BillingError} = require('../lib/billing.cjs');
exports.handler = async function(event) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
  if (event.httpMethod !== 'POST') return {statusCode: 405, headers, body: JSON.stringify({error: 'Gebruik POST.'})};
  const identity = await authenticateUser(event);
  if (identity.denied) return {...identity.denied, headers};
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return {statusCode: 400, headers, body: JSON.stringify({error: 'Ongeldige betaalkeuze.'})}; }
  try {
    const result = await createCheckout(identity, body.plan);
    return {statusCode: 200, headers, body: JSON.stringify(result)};
  } catch (error) {
    return {statusCode: error instanceof BillingError ? error.statusCode : 503, headers,
      body: JSON.stringify({error: error instanceof BillingError ? error.message : 'De betaalpagina kan tijdelijk niet worden geopend. Probeer opnieuw.'})};
  }
};
