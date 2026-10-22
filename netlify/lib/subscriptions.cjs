const model = require('../../subscription-access.js');

function baseUrl() {
  const projectId = require('./project.cjs').projectId();
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  return (host ? 'http://' + host : 'https://firestore.googleapis.com') +
    '/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents';
}

function fieldValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return fields(value.mapValue.fields || {});
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fieldValue);
  throw new Error('Onbekend veld in abonnementsconfiguratie.');
}
function fields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fieldValue(entry)]));
}

async function firestoreRequest(route, token, options = {}) {
  const response = await fetch(baseUrl() + route, { ...options,
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error('Abonnementsgegevens konden niet worden gecontroleerd.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function subscriptionStatus(identity, { startTrial = false } = {}) {
  const document = await firestoreRequest('/billing/config', identity.token);
  const config = document ? fields(document.fields || {}) : null;
  let access = null;
  if (config?.enabled === true && identity.user.admin !== true) {
    const accessPath = '/billingAccess/' + encodeURIComponent(identity.user.uid);
    let snapshot = await firestoreRequest(accessPath, identity.token);
    if (!snapshot && startTrial) {
      // The user's ID token enforces the same rules as the browser. No service
      // account is needed, and the timestamp is assigned by Firestore itself.
      const name = baseUrl().split('/v1/')[1] + accessPath;
      try {
        await firestoreRequest(':commit', identity.token, {
          method: 'POST', body: JSON.stringify({writes: [{
            update: {name, fields: {status: {stringValue: 'trial'}}},
            updateTransforms: [{fieldPath: 'trialStartedAt', setToServerValue: 'REQUEST_TIME'}],
            currentDocument: {exists: false}
          }]})
        });
      } catch (error) {
        if (error.status !== 409 && error.status !== 412) throw error;
      }
      snapshot = await firestoreRequest(accessPath, identity.token);
    }
    access = snapshot ? fields(snapshot.fields || {}) : null;
  }
  const now = Date.now();
  return {...model.accessState(config, access, now, identity.user.admin === true),
    ...(access && ['active', 'lifetime'].includes(access.status) && Number.isFinite(model.milliseconds(access.paidStartsAt)) ?
      {prepaid: true} : {}),
    enabled: config?.enabled === true, serverNow: now,
    provider: config?.provider || null, currency: 'EUR', taxIncluded: config?.taxIncluded === true,
    plans: model.planOptions(config)};
}

module.exports = {subscriptionStatus};
