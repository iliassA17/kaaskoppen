const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {assertProductionProject, assertSandboxProject, assertBillingEnvironment} = require('../netlify/lib/project.cjs');

const production = {projectId: 'boekingsschema', key: 'sk_live_local_fixture',
  liveEnabled: 'true', context: 'production', appOrigin: 'https://boekingschema.netlify.app',
  siteUrl: 'https://boekingschema.netlify.app', serviceProjectId: 'boekingsschema'};

test('de overgezette webapp houdt het productieproject en dezelfde toegestane openbare sleutel', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'app-main.js'), 'utf8');
  const config = script.match(/var firebaseConfig = \{[\s\S]*?\n\};/)[0];
  assert.match(config, /projectId: "boekingsschema"/);
  assert.match(config, /authDomain: "boekingsschema\.firebaseapp\.com"/);
  assert.match(config, /storageBucket: "boekingsschema\.firebasestorage\.app"/);
  assert.doesNotMatch(config, /bs-test-b94c7/);
  const publicKey = config.match(/apiKey: "([^"]+)"/)[1];
  assert.ok(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8').includes('"' + publicKey + '"'));
  assert.match(html, /<script defer src="\/app-main\.js"><\/script>/);
  assert.doesNotMatch(html, /TESTOMGEVING|bs-test-b94c7/);
});

test('productie accepteert alleen de echte combinatie van project, livesleutel, serviceaccount en site', () => {
  assert.equal(assertBillingEnvironment(production), true);
  assert.equal(assertBillingEnvironment({...production, key: 'rk_live_local_fixture'}), true);
  for (const invalid of [
    {key: 'sk_test_local_fixture'}, {key: 'rk_test_local_fixture'}, {liveEnabled: 'false'}, {liveEnabled: undefined},
    {context: 'deploy-preview'}, {context: 'branch-deploy'},
    {projectId: 'bs-test-b94c7'}, {serviceProjectId: 'bs-test-b94c7'},
    {appOrigin: 'https://boekingsschema-stripe-test.netlify.app'},
    {siteUrl: 'https://boekingsschema-stripe-test.netlify.app'},
  ]) assert.throws(() => assertBillingEnvironment({...production, ...invalid}));
  assert.throws(() => assertProductionProject('bs-test-b94c7'));
  assert.throws(() => assertSandboxProject('boekingsschema'));
});

test('de emulatoruitzondering vereist beide lokale diensten en accepteert geen livesleutel', () => {
  const local = {...production, projectId: 'demo-kaaskoppen', serviceProjectId: 'demo-kaaskoppen', key: 'sk_test_local_fixture'};
  assert.equal(assertBillingEnvironment(local), false);
  assert.equal(assertBillingEnvironment({...local, key: 'rk_test_local_fixture'}), false);
  assert.throws(() => assertBillingEnvironment({...local, key: 'sk_live_local_fixture'}));
  assert.throws(() => assertBillingEnvironment({...local, key: 'rk_live_local_fixture'}));
  for (const missing of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
    const previous = process.env[missing];
    try {
      delete process.env[missing];
      assert.throws(() => assertProductionProject('demo-kaaskoppen'));
    } finally {
      if (previous === undefined) delete process.env[missing]; else process.env[missing] = previous;
    }
  }
});

test('het productie-inrichtingscommando weigert een testproject en testsleutel voordat credentials worden gelezen', () => {
  for (const [project, key, message] of [
    ['bs-test-b94c7', 'sk_live_local_fixture', /uitsluitend.*boekingsschema/],
    ['boekingsschema', 'sk_test_local_fixture', /uitsluitend.*livesleutel/],
    ['boekingsschema', 'rk_test_local_fixture', /uitsluitend.*livesleutel/],
    ['demo-kaaskoppen', 'sk_live_local_fixture', /verwacht.*boekingsschema/],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/setup-subscriptions.cjs', '--project', project, '--apply'], {
      encoding: 'utf8', env: {...process.env, STRIPE_SECRET_KEY: key, GOOGLE_APPLICATION_CREDENTIALS: '/missing-private-file'},
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /(?:sk|rk)_(?:live|test)_local_fixture/);
  }
});

test('een BS-test-serviceaccount kan geen productieprijzen of vrijstellingen inrichten', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaskoppen-credential-guard-'));
  const file = path.join(directory, 'fixture.json');
  try {
    // Deliberately not a credential: the project guard must reject this before
    // Firebase attempts certificate initialization or any network request.
    fs.writeFileSync(file, JSON.stringify({project_id: 'bs-test-b94c7'}));
    const result = spawnSync(process.execPath, ['scripts/setup-subscriptions.cjs', '--project', 'boekingsschema', '--apply'], {
      encoding: 'utf8', timeout: 10000,
      env: {...process.env, STRIPE_SECRET_KEY: 'rk_live_local_fixture', GOOGLE_APPLICATION_CREDENTIALS: file},
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /serviceaccount hoort niet bij Firebase-project boekingsschema/);
    assert.equal(result.stdout, '');
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
