const {authenticateUser} = require('../lib/auth.cjs');
const {createPortal, BillingError} = require('../lib/billing.cjs');
exports.handler = async function(event) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
  if (event.httpMethod !== 'POST') return {statusCode: 405, headers, body: JSON.stringify({error: 'Gebruik POST.'})};
  const identity = await authenticateUser(event);
  if (identity.denied) return {...identity.denied, headers};
  try { return {statusCode: 200, headers, body: JSON.stringify(await createPortal(identity))}; }
  catch (error) {
    return {statusCode: error instanceof BillingError ? error.statusCode : 503, headers,
      body: JSON.stringify({error: error instanceof BillingError ? error.message : 'Abonnement beheren kan tijdelijk niet worden geopend. Probeer opnieuw.'})};
  }
};
