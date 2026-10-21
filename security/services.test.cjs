const { before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
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

test('bestaande korte namen, hoofdletters, spaties en accenten behouden hun koppelingen', async () => {
  const names = ['a', '12', 'Ilias', '_naam', 'Jan de Vries', 'Jos\u00e9.1', 'x'.repeat(40)];
  for (const [i, name] of names.entries()) await legacyAccount(name, { email: `legacy${i}@example.test` });
  assert.deepEqual(await migrate({ database, authentication }), { accounts: names.length, codes: 0, applied: false });
  await migrate({ database, authentication, apply: true, adminUsers: ['Ilias'] });
  for (const name of names) {
    const profile = (await database.collection('accounts').doc(name).get()).data();
    assert.equal(profile.gebruiker, name);
    assert.equal(profile.uid, legacyUid(name));
    assert.deepEqual((await database.doc('authUsers/' + profile.uid).get()).data(), { gebruiker: name });
    assert.equal((await database.collection('boekingen').doc(name).get()).data().gebruiker, name);
    assert.equal((await authentication.getUser(profile.uid)).displayName, name);
  }
  assert.equal((await authentication.getUser(legacyUid('Ilias'))).customClaims.admin, true);
  await migrate({ database, authentication, apply: true });
  assert.equal((await authentication.listUsers()).users.length, names.length);
});

test('onveilige oude namen worden samen gemeld voordat ook maar een account wordt overgezet', async () => {
  await legacyAccount();
  // Firestore itself rejects reserved __...__ document IDs on creation.
  const names = ['constructor', 'prototype', "O'Neil", '<script>'];
  for (const [i, name] of names.entries()) await legacyAccount(name, { email: `blocked${i}@example.test` });
  await assert.rejects(migrate({ database, authentication, apply: true }), error => {
    for (const name of names) assert.ok(error.message.includes(JSON.stringify(name)));
    assert.match(error.message, /Hernoem of verwijder deze accounts niet zelf/);
    return true;
  });
  assert.equal((await authentication.listUsers()).users.length, 0);
  assert.equal((await database.doc('accounts/alice').get()).data().hash, 'oude-onveilige-hash');
});

test('beheercommando\'s weigeren uitgeschakelde TLS-controle voordat ze Firebase benaderen', () => {
  for (const script of ['migrate-auth.cjs', 'set-role.cjs', 'backup-firestore.cjs', 'setup-subscriptions.cjs', 'setup-sandbox.cjs']) {
    const result = spawnSync(process.execPath, ['scripts/' + script, '--project', projectId, '--apply'], {
      cwd: require('node:path').resolve(__dirname, '..'),
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', GOOGLE_APPLICATION_CREDENTIALS: '/bestaat-niet.json' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Certificaatcontrole is uitgeschakeld/);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /bestaat-niet|ENOENT/);
  }
});

test('oude profielvelden leveren nooit automatisch beheerdersrechten op', async () => {
  await legacyAccount('alice', { isBeheerder: true, admin: true });
  await migrate({ database, authentication, apply: true });
  const authUser = await authentication.getUser(legacyUid('alice'));
  assert.equal(authUser.customClaims?.admin, undefined);
  assert.equal(authUser.customClaims?.beheerder, undefined);
  assert.equal((await database.doc('accounts/alice').get()).data().isBeheerder, false);
});

test('alle groepen dubbele e-mails worden zonder e-mailadressen gemeld voor enige Auth-aanroep of wijziging', async () => {
  await legacyAccount();
  await legacyAccount('bob', { email: ' ALICE@EXAMPLE.TEST ' });
  await legacyAccount('carol', { email: 'ander@example.test' });
  await legacyAccount('dave', { email: 'ander@example.test' });
  await legacyAccount('eve', { email: 'ander@example.test' });
  const accountsBefore = (await database.collection('accounts').get()).docs.map(doc => [doc.id, doc.data()]);
  const bookingsBefore = (await database.collection('boekingen').get()).docs.map(doc => [doc.id, doc.data()]);
  const noAuthentication = new Proxy({}, { get() { throw new Error('Firebase Authentication mag nog niet benaderd worden.'); } });
  for (const apply of [false, true]) {
    await assert.rejects(migrate({ database, authentication: noAuthentication, apply }), error => {
      assert.match(error.message, /hetzelfde e-mailadres/);
      assert.match(error.message, /Groep 1: "alice", "bob"/);
      assert.match(error.message, /Groep 2: "carol", "dave", "eve"/);
      assert.match(error.message, /Er is niets gewijzigd/);
      assert.doesNotMatch(error.message, /@example\.test/i);
      return true;
    });
  }
  assert.equal((await authentication.listUsers()).users.length, 0);
  assert.deepEqual((await database.collection('accounts').get()).docs.map(doc => [doc.id, doc.data()]), accountsBefore);
  assert.deepEqual((await database.collection('boekingen').get()).docs.map(doc => [doc.id, doc.data()]), bookingsBefore);
  assert.equal((await database.collection('authUsers').get()).empty, true);
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

async function subscriptionAccount(status) {
  await database.doc('billing/config').set({enabled: true, taxIncluded: true,
    plans: {maand: {amountCents: 1599}, halfjaar: {amountCents: 8000}, jaar: {amountCents: 15000}, levenslang: {amountCents: 50000}}});
  await database.doc('authUsers/api-test').set({gebruiker: 'alice'});
  await database.doc('accounts/alice').set({uid: 'api-test', gebruiker: 'alice', email: 'api@example.test'});
  if (status) await database.doc('billingAccess/api-test').set(status);
}

test('de statusfunctie weigert ontbrekende sessies en onbevestigde adressen', async () => {
  const {handler} = require('../netlify/functions/subscription-status.js');
  assert.equal((await handler({httpMethod: 'GET', headers: {}})).statusCode, 405);
  assert.equal((await handler({httpMethod: 'POST', headers: {}})).statusCode, 401);
  assert.equal((await handler(await eventFor({verified: false}))).statusCode, 403);
});

test('de eerste statusaanvraag start precies één proefweek met Firestore-servertijd', async () => {
  const event = await eventFor();
  await subscriptionAccount();
  const {handler} = require('../netlify/functions/subscription-status.js');
  const before = Date.now();
  const first = await handler(event);
  assert.equal(first.statusCode, 200, first.body);
  const result = JSON.parse(first.body);
  assert.equal(result.allowed, true);
  assert.equal(result.kind, 'trial');
  assert.deepEqual(result.plans.map(plan => plan.id), ['maand', 'halfjaar', 'jaar', 'levenslang']);
  const original = (await database.doc('billingAccess/api-test').get()).data();
  assert.equal(original.status, 'trial');
  assert.ok(original.trialStartedAt.toMillis() >= before && original.trialStartedAt.toMillis() <= Date.now());
  assert.equal(result.expiresAt, original.trialStartedAt.toMillis() + 7 * 86400000);
  assert.equal((await handler(event)).statusCode, 200);
  assert.deepEqual((await database.doc('billingAccess/api-test').get()).data(), original);
  assert.equal(await requireUser(event), null);
});

test('twee gelijktijdige eerste aanmeldingen behouden dezelfde proefperiode', async () => {
  const event = await eventFor();
  await subscriptionAccount();
  const {handler} = require('../netlify/functions/subscription-status.js');
  const responses = await Promise.all([handler(event), handler(event)]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  const results = responses.map(response => JSON.parse(response.body));
  assert.equal(results[0].expiresAt, results[1].expiresAt);
});

test('verlopen gebruikers krijgen wel de betaalopties maar geen toegang tot product-API’s', async () => {
  const event = await eventFor();
  await subscriptionAccount({status: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() - 8 * 86400000)});
  const {handler} = require('../netlify/functions/subscription-status.js');
  const before = (await database.doc('billingAccess/api-test').get()).data();
  const response = await handler(event);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).allowed, false);
  assert.equal((await requireUser(event)).statusCode, 402);
  assert.equal((await require('../netlify/functions/pathe.js').handler(event)).statusCode, 402);
  assert.deepEqual((await database.doc('billingAccess/api-test').get()).data(), before);
});

test('een geldige betaalperiode en levenslange toegang werken zonder een nieuwe proefperiode', async () => {
  const event = await eventFor();
  for (const access of [{status: 'active', validUntil: Timestamp.fromMillis(Date.now() + 86400000)},
    {status: 'lifetime'}, {status: 'free'}]) {
    await subscriptionAccount(access);
    assert.equal(await requireUser(event), null);
    assert.deepEqual((await database.doc('billingAccess/api-test').get()).data(), access);
  }
});

test('serverfuncties weigeren ontbrekende en vervalste sessies', async () => {
  const pathe = require('../netlify/functions/pathe.js');
  const push = require('../netlify/functions/send-push.js');
  for (const handler of [pathe.handler, push.handler,
    require('../netlify/functions/create-checkout-session.js').handler,
    require('../netlify/functions/create-portal-session.js').handler]) {
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
