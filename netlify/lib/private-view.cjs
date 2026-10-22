const {getApps, initializeApp, cert} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {authenticateUser} = require('./auth.cjs');

class ViewError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

function privateDatabase() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new ViewError('Veilige verbinding is niet ingesteld.');
  const project = require('./project.cjs').projectId();
  const emulator = project === 'demo-kaaskoppen' &&
    process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
  let options = {projectId: project};
  if (!emulator) {
    let account;
    try { account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
    catch { throw new ViewError('Deze weergave is tijdelijk niet beschikbaar.'); }
    if (account.project_id !== project) throw new ViewError('Deze weergave is tijdelijk niet beschikbaar.');
    options.credential = cert(account);
  }
  const name = 'private-views';
  const app = getApps().find(app => app.name === name) || initializeApp(options, name);
  return getFirestore(app);
}

async function ownAccount(identity, database) {
  const uid = identity.user.uid;
  const mapping = (await database.doc('authUsers/' + uid).get()).data();
  const username = mapping?.gebruiker;
  if (typeof username !== 'string' || !username || username.length > 128 || username.includes('/')) {
    throw new ViewError('Je account kan niet worden gecontroleerd.', 403);
  }
  const account = (await database.collection('accounts').doc(username).get()).data();
  if (account?.uid !== uid) throw new ViewError('Je account kan niet worden gecontroleerd.', 403);
  return {username, account};
}

function privateViewHandler(load, {memberOnly = false, image = false} = {}) {
  return async event => {
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Authorization'};
    const error = (statusCode, message) => ({statusCode, headers, body: JSON.stringify({error: message})});
    if (event.httpMethod !== 'POST') return error(405, 'Gebruik POST.');
    const identity = await authenticateUser(event);
    if (identity.denied) return {...identity.denied, headers};
    try {
      let input;
      try { input = JSON.parse(event.body || '{}'); } catch { throw new ViewError('Ongeldig verzoek.', 400); }
      if (!input || Array.isArray(input) || typeof input !== 'object') throw new ViewError('Ongeldig verzoek.', 400);
      if (memberOnly && !(await require('./subscriptions.cjs').subscriptionStatus(identity)).allowed) {
        throw new ViewError('Je proefperiode of abonnement is afgelopen.', 402);
      }
      const result = await load(identity, input);
      return {statusCode: 200, headers: {...headers, ...(image ? {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff'
      } : {})}, body: image ? result : JSON.stringify(result)};
    } catch (failure) {
      return error(failure instanceof ViewError ? failure.status : 503,
        failure instanceof ViewError ? failure.message : 'Deze weergave is tijdelijk niet beschikbaar. Probeer opnieuw.');
    }
  };
}

const dayString = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(now));
function shiftDay(day, count) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
module.exports = {ViewError, privateDatabase, ownAccount, privateViewHandler, dayString, shiftDay, validDay};
