const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function firebaseAuth() {
  const name = 'netlify-auth';
  const app = getApps().find(app => app.name === name) || initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'boekingsschema',
  }, name);
  return getAuth(app);
}

async function requireUser(event, staffOnly = false) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  if (!match) return { statusCode: 401, body: JSON.stringify({ error: 'Log eerst in.' }) };
  try {
    const user = await firebaseAuth().verifyIdToken(match[1]);
    if (!user.email_verified) return { statusCode: 403, body: JSON.stringify({ error: 'Bevestig eerst je e-mailadres.' }) };
    if (staffOnly && user.admin !== true && user.beheerder !== true) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Geen beheerdersrechten.' }) };
    }
    return null;
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'Je sessie is ongeldig of verlopen. Log opnieuw in.' }) };
  }
}

module.exports = { requireUser };
