const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function firebaseAuth() {
  const name = 'netlify-auth';
  const app = getApps().find(app => app.name === name) || initializeApp({
    projectId: require('./project.cjs').projectId(),
  }, name);
  return getAuth(app);
}

async function authenticateUser(event, staffOnly = false) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  if (!match) return { denied: { statusCode: 401, body: JSON.stringify({ error: 'Log eerst in.' }) } };
  try {
    const user = await firebaseAuth().verifyIdToken(match[1]);
    if (!user.email_verified) return { denied: { statusCode: 403, body: JSON.stringify({ error: 'Bevestig eerst je e-mailadres.' }) } };
    if (staffOnly && user.admin !== true && user.beheerder !== true) {
      return { denied: { statusCode: 403, body: JSON.stringify({ error: 'Geen beheerdersrechten.' }) } };
    }
    return {user, token: match[1]};
  } catch {
    return { denied: { statusCode: 401, body: JSON.stringify({ error: 'Je sessie is ongeldig of verlopen. Log opnieuw in.' }) } };
  }
}

async function requireUser(event, staffOnly = false) {
  const identity = await authenticateUser(event, staffOnly);
  if (identity.denied) return identity.denied;
  if (identity.user.admin === true) return null;
  try {
    const {subscriptionStatus} = require('./subscriptions.cjs');
    const access = await subscriptionStatus(identity);
    return access.allowed ? null : {statusCode: 402, body: JSON.stringify({
      error: 'Je proefperiode of abonnement is afgelopen. Kies een abonnement om verder te gaan.',
      code: 'subscription-required'
    })};
  } catch {
    return {statusCode: 503, body: JSON.stringify({error: 'Je toegang kan tijdelijk niet worden gecontroleerd. Probeer opnieuw.'})};
  }
}

module.exports = { requireUser, authenticateUser };
