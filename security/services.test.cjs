const { before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { migrate, legacyUid } = require('../scripts/migrate-auth.cjs');
const { requireUser } = require('../netlify/lib/auth.cjs');

const projectId = 'demo-kaaskoppen';
let authentication, database;
before(() => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  const app = initializeApp({ projectId }, 'service-tests');
  authentication = getAuth(app); database = getFirestore(app);
});
beforeEach(async () => {
  assert.equal((await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' })).ok, true);
  assert.equal((await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
});

async function legacyAccount(name = 'alice', extra = {}) {
  await database.doc('accounts/' + name).set({ gebruiker: name, email: name + '@example.test', hash: 'oude-onveilige-hash', ...extra });
  await database.doc('boekingen/' + name).set({ gebruiker: name, prijs: 0, naam: 'Bestaand' });
}

test('migratie controleert standaard zonder accounts, wachtwoorden of boekingen te wijzigen', async () => {
  await legacyAccount();
  const result = await migrate({ database, authentication });
  assert.deepEqual(result, { accounts: 1, codes: 0, applied: false });
  assert.equal((await database.doc('accounts/alice').get()).data().hash, 'oude-onveilige-hash');
  assert.equal((await authentication.listUsers()).users.length, 0);
});

test('migratie behoudt boekingen, verwijdert oude hashes en is herhaalbaar', async () => {
  await legacyAccount();
  await database.doc('codes/willekeurig-id').set({ code: 'UITNODIGING-123', gebruikt: false, gebruiker: null });
  await database.doc('resets/alice').set({ code: 'oude-reset' });
  const options = { database, authentication, apply: true, adminUsers: ['alice'] };
  await migrate(options);
  const account = (await database.doc('accounts/alice').get()).data();
  assert.equal(account.uid, legacyUid('alice'));
  assert.equal(account.hash, undefined);
  assert.equal((await database.doc('boekingen/alice').get()).data().prijs, 0);
  assert.deepEqual((await database.doc('authUsers/' + account.uid).get()).data(), { gebruiker: 'alice' });
  const authUser = await authentication.getUser(account.uid);
  assert.equal(authUser.emailVerified, false);
  assert.equal(authUser.customClaims.admin, true);
  assert.equal((await database.doc('codes/willekeurig-id').get()).exists, false);
  assert.equal((await database.doc('codes/UITNODIGING-123').get()).exists, true);
  assert.equal((await database.doc('resets/alice').get()).exists, false);
  await migrate(options);
  assert.equal((await authentication.listUsers()).users.length, 1);
});

test('oude profielvelden leveren nooit automatisch beheerdersrechten op', async () => {
  await legacyAccount('alice', { isBeheerder: true, admin: true });
  await migrate({ database, authentication, apply: true });
  const authUser = await authentication.getUser(legacyUid('alice'));
  assert.equal(authUser.customClaims?.admin, undefined);
  assert.equal(authUser.customClaims?.beheerder, undefined);
  assert.equal((await database.doc('accounts/alice').get()).data().isBeheerder, false);
});

test('dubbele e-mailadressen stoppen de migratie voordat gegevens gewijzigd worden', async () => {
  await legacyAccount();
  await legacyAccount('bob', { email: 'alice@example.test' });
  await assert.rejects(migrate({ database, authentication, apply: true }), /hetzelfde e-mailadres/);
  assert.equal((await authentication.listUsers()).users.length, 0);
  assert.equal((await database.doc('accounts/alice').get()).data().hash, 'oude-onveilige-hash');
});

test('een bestaande andere Firebase-identiteit wordt niet ongemerkt overgenomen', async () => {
  await legacyAccount();
  await authentication.createUser({ uid: 'ander-uid', email: 'alice@example.test' });
  await assert.rejects(migrate({ database, authentication, apply: true }), /conflicterende Firebase-identiteit/);
  assert.equal((await database.doc('accounts/alice').get()).data().uid, undefined);
});

async function eventFor({ verified = true, admin = false } = {}) {
  const uid = 'api-test';
  await authentication.createUser({ uid, email: 'api@example.test', password: 'SterkTestWachtwoord!42', emailVerified: verified });
  if (admin) await authentication.setCustomUserClaims(uid, { admin: true });
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'api@example.test', password: 'SterkTestWachtwoord!42', returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  const data = await response.json();
  return { httpMethod: 'POST', headers: { authorization: 'Bearer ' + data.idToken }, body: '{}' };
}

test('serverfuncties weigeren ontbrekende en vervalste sessies', async () => {
  const pathe = require('../netlify/functions/pathe.js');
  const push = require('../netlify/functions/send-push.js');
  for (const handler of [pathe.handler, push.handler]) {
    assert.equal((await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 401);
    assert.equal((await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer vervalst' }, body: '{}' })).statusCode, 401);
  }
});

test('serverfuncties weigeren een onbevestigd e-mailadres', async () => {
  assert.equal((await requireUser(await eventFor({ verified: false }))).statusCode, 403);
});

test('een gewone gebruiker kan geen pushberichten versturen', async () => {
  const event = await eventFor();
  assert.equal(await requireUser(event), null);
  assert.equal((await require('../netlify/functions/send-push.js').handler(event)).statusCode, 403);
});

test('een geldig admin-token wordt door de server geverifieerd', async () => {
  assert.equal(await requireUser(await eventFor({ admin: true }), true), null);
});
