const SANDBOX_PROJECT = 'bs-test-b94c7';
const PRODUCTION_PROJECT = 'boekingsschema';
const PRODUCTION_ORIGIN = 'https://boekingschema.netlify.app';

function isEmulator(projectId) {
  return projectId === 'demo-kaaskoppen' &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' &&
    process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080';
}

function assertSandboxProject(projectId) {
  if (projectId !== SANDBOX_PROJECT && !isEmulator(projectId)) {
    throw new Error('Deze testversie werkt uitsluitend met Firebase-project bs-test-b94c7.');
  }
  return projectId;
}

function assertProductionProject(projectId) {
  if (projectId !== PRODUCTION_PROJECT && !isEmulator(projectId)) {
    throw new Error('Deze productieversie werkt uitsluitend met Firebase-project boekingsschema.');
  }
  return projectId;
}

function assertBillingEnvironment({projectId, key, liveEnabled, context, appOrigin, siteUrl, serviceProjectId}) {
  assertProductionProject(projectId);
  if (serviceProjectId !== projectId) throw new Error('Het serviceaccount hoort niet bij het ingestelde Firebase-project.');
  if (isEmulator(projectId)) {
    if (!/^(?:sk|rk)_test_/.test(key || '')) throw new Error('De lokale emulators accepteren uitsluitend Stripe-testsleutels.');
    return false;
  }
  if (!/^(?:sk|rk)_live_/.test(key || '')) throw new Error('Gebruik uitsluitend een Stripe-livesleutel bij je echte Firebase-project.');
  if (liveEnabled !== 'true' || (context && context !== 'production')) {
    throw new Error('Live betalingen zijn uitsluitend op de productieomgeving beschikbaar.');
  }
  let siteOrigin = null;
  try { if (siteUrl) siteOrigin = new URL(siteUrl).origin; }
  catch { throw new Error('Het adres van de productiesite is ongeldig.'); }
  if (appOrigin !== PRODUCTION_ORIGIN || (siteOrigin && siteOrigin !== PRODUCTION_ORIGIN)) {
    throw new Error('Deze betaalversie hoort uitsluitend bij https://boekingschema.netlify.app.');
  }
  return true;
}

function projectId() {
  return assertProductionProject(process.env.FIREBASE_PROJECT_ID || PRODUCTION_PROJECT);
}
module.exports = {SANDBOX_PROJECT, PRODUCTION_PROJECT, PRODUCTION_ORIGIN,
  assertSandboxProject, assertProductionProject, assertBillingEnvironment, projectId};
