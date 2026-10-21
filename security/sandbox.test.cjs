const {before, beforeEach, test} = require('node:test');
const assert = require('node:assert/strict');
const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore} = require('firebase-admin/firestore');
const {setupSandbox} = require('../scripts/setup-sandbox.cjs');
const {assertSandboxProject} = require('../netlify/lib/project.cjs');
const projectId = 'demo-kaaskoppen';
let options, database, authentication;

before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  const app = initializeApp({projectId}, 'sandbox-setup-tests');
  database = getFirestore(app); authentication = getAuth(app);
});
beforeEach(async () => {
  for (const url of ['http://127.0.0.1:9099/emulator/v1/projects/' + projectId + '/accounts',
    'http://127.0.0.1:8080/emulator/v1/projects/' + projectId + '/databases/(default)/documents']) {
    assert.equal((await fetch(url, {method: 'DELETE'})).ok, true);
  }
  const prices = new Map();
  options = {database, authentication, projectId, stripeKey: 'sk_test_local_fixture', password: 'ZelfgekozenTest!4321',
    stripe: {products: {create: async () => ({id: 'prod_sandbox'})}, prices: {
      create: async params => {
        const value = {...params, id: 'price_' + params.metadata.plan, active: true,
          type: params.recurring ? 'recurring' : 'one_time'};
        prices.set(value.id, value); return value;
      }, retrieve: async id => prices.get(id)
    }}};
});

test('sandboxcontrole schrijft niets en weigert productieprojecten, livesleutels en onbekende accounts', async () => {
  const untouched = new Proxy({}, {get() { throw new Error('Mag niet worden benaderd'); }});
  await assert.rejects(setupSandbox({...options, database: untouched, projectId: 'boekingsschema', apply: true}), /uitsluitend/);
  await assert.rejects(setupSandbox({...options, database: untouched, stripeKey: 'sk_live_fixture', apply: true}), /Stripe-testsleutel/);
  assert.equal((await setupSandbox(options)).applied, false);
  assert.equal((await authentication.listUsers()).users.length, 0);
  assert.equal((await database.collection('billing').get()).size, 0);
  await database.doc('accounts/echt-account').set({uid: 'ander'});
  await assert.rejects(setupSandbox({...options, apply: true}), /andere accounts/);
  assert.deepEqual((await database.doc('accounts/echt-account').get()).data(), {uid: 'ander'});
});

test('sandboxinrichting maakt zes bevestigde testaccounts waarvan alleen de oorspronkelijke vijf vrijgesteld zijn', async () => {
  const result = await setupSandbox({...options, apply: true});
  assert.equal(result.enabled, false);
  assert.doesNotMatch(JSON.stringify(result), /ZelfgekozenTest|sk_test/);
  assert.equal((await authentication.listUsers()).users.length, 6);
  const admin = await authentication.getUser('bs-sandbox-beheerder');
  assert.equal(admin.customClaims.admin, true);
  assert.equal(admin.emailVerified, true);
  assert.equal((await authentication.getUser('bs-sandbox-proef')).customClaims?.admin, undefined);
  assert.equal((await database.collection('billingAccess').get()).size, 5);
  assert.equal((await database.doc('billingAccess/bs-sandbox-proef').get()).exists, false);
  assert.deepEqual((await database.doc('authUsers/bs-sandbox-proef').get()).data(), {gebruiker: 'proef'});
  const first = (await database.doc('accounts/proef').get()).updateTime;
  await setupSandbox({...options, apply: true});
  assert.equal((await database.doc('accounts/proef').get()).updateTime.isEqual(first), true);
  await setupSandbox({...options, apply: true, enable: true});
  assert.equal((await database.doc('billing/config').get()).data().enabled, true);
});

test('proefperiode verlopen voor een testaccount overschrijft geen betaalde toegang of boekingen', async () => {
  await setupSandbox({...options, apply: true});
  await database.doc('boekingen/voorbeeld').set({gebruiker: 'proef', prijs: 0});
  await setupSandbox({...options, apply: true, expire: true});
  const expired = (await database.doc('billingAccess/bs-sandbox-proef').get()).data();
  assert.ok(expired.trialStartedAt.toMillis() < Date.now() - 7 * 86400000);
  await database.doc('billingAccess/bs-sandbox-proef').set({status: 'lifetime'});
  await assert.rejects(setupSandbox({...options, apply: true, expire: true}), /niet overschreven/);
  assert.deepEqual((await database.doc('billingAccess/bs-sandbox-proef').get()).data(), {status: 'lifetime'});
  assert.deepEqual((await database.doc('boekingen/voorbeeld').get()).data(), {gebruiker: 'proef', prijs: 0});
});

test('de lokale emulatoruitzondering kan niet naar een ander Firebase-cloudproject wijzen', () => {
  assert.equal(assertSandboxProject('bs-test-b94c7'), 'bs-test-b94c7');
  assert.equal(assertSandboxProject('demo-kaaskoppen'), 'demo-kaaskoppen');
  assert.throws(() => assertSandboxProject('ander-testproject'), /uitsluitend/);
});

test('een betaling tijdens de inrichting kan niet door proefperiode verlopen worden overschreven', async () => {
  await setupSandbox({...options, apply: true});
  const original = options.stripe.prices.retrieve;
  options.stripe.prices.retrieve = async priceId => {
    await database.doc('billingAccess/bs-sandbox-proef').set({status: 'lifetime'});
    return original(priceId);
  };
  await assert.rejects(setupSandbox({...options, apply: true, expire: true}), /inmiddels betaalde/);
  assert.deepEqual((await database.doc('billingAccess/bs-sandbox-proef').get()).data(), {status: 'lifetime'});
});
