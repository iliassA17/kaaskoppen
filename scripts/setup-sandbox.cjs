const {readFile} = require('node:fs/promises');
const {initializeApp, cert} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {SANDBOX_PROJECT, assertSandboxProject} = require('../netlify/lib/project.cjs');
const {setupSubscriptions} = require('./setup-subscriptions.cjs');

const BASELINE = ['beheerder', 'bestaand1', 'bestaand2', 'bestaand3', 'bestaand4'];
const nameUid = name => 'bs-sandbox-' + name;
const emailFor = name => name + '@example.test';

async function setupSandbox({database, authentication, stripe, projectId, stripeKey,
  password, apply = false, enable = false, expire = false}) {
  assertSandboxProject(projectId);
  if (!/^sk_test_/.test(stripeKey || '')) throw new Error('Gebruik uitsluitend de geheime Stripe-testsleutel die met sk_test_ begint.');
  const marker = await database.doc('billing/setup').get();
  const accounts = await database.collection('accounts').get();
  if (!marker.exists) {
    for (const account of accounts.docs) {
      if (!BASELINE.includes(account.id) || account.data().source !== 'sandbox' || account.data().uid !== nameUid(account.id)) {
        throw new Error('Het testproject bevat al andere accounts. Er is niets overschreven.');
      }
    }
    const existing = await authentication.listUsers(1000);
    if (existing.pageToken || existing.users.some(user => !BASELINE.some(name => user.uid === nameUid(name) && user.email === emailFor(name)))) {
      throw new Error('Het testproject bevat al andere inlogaccounts. Er is niets overschreven.');
    }
  }
  if (apply && (typeof password !== 'string' || password.length < 12)) {
    throw new Error('Stel SANDBOX_PASSWORD privé in met een zelfgekozen testwachtwoord van minimaal 12 tekens.');
  }
  if (expire) {
    const access = (await database.doc('billingAccess/' + nameUid('proef')).get()).data();
    if (access && !['trial', 'expired'].includes(access.status)) {
      throw new Error('De proefgebruiker heeft al betaalde of vrijgestelde toegang. Die wordt niet overschreven.');
    }
  }
  const result = {project: projectId, applied: apply, enabled: enable,
    proefVerlopen: expire, beheerder: emailFor('beheerder'), proefgebruiker: emailFor('proef')};
  if (!apply) return result;

  async function ensureUser(name, admin = false) {
    const uid = nameUid(name), email = emailFor(name);
    let user;
    try { user = await authentication.getUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    const profile = await database.doc('accounts/' + name).get();
    const mapping = await database.doc('authUsers/' + uid).get();
    if ((user && user.email !== email) || (profile.exists && (profile.data().uid !== uid || profile.data().source !== 'sandbox')) ||
      (mapping.exists && mapping.data().gebruiker !== name)) throw new Error('Een testaccount heeft een andere koppeling. Er is niets overschreven.');
    if (!user) user = await authentication.createUser({uid, email, password, emailVerified: true});
    if (admin && user.customClaims?.admin !== true) await authentication.setCustomUserClaims(uid, {...user.customClaims, admin: true});
    const batch = database.batch();
    if (!profile.exists) batch.create(profile.ref, {uid, gebruiker: name, email, source: 'sandbox', aangemaakt: new Date().toISOString()});
    if (!mapping.exists) batch.create(mapping.ref, {gebruiker: name});
    await batch.commit();
  }
  // Reproduce the five existing accounts on the empty test project. The paying
  // trial user is created afterwards, so it never receives the free exemption.
  for (const name of BASELINE) await ensureUser(name, name === 'beheerder');
  const configured = await setupSubscriptions({database, stripe, projectId, liveMode: false, apply: true, enable});
  await ensureUser('proef');
  if (expire) await database.runTransaction(async tx => {
    const ref = database.doc('billingAccess/' + nameUid('proef'));
    const current = (await tx.get(ref)).data();
    if (current && !['trial', 'expired'].includes(current.status)) {
      throw new Error('De proefgebruiker heeft inmiddels betaalde of vrijgestelde toegang. Die wordt niet overschreven.');
    }
    tx.set(ref, {status: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() - 8 * 86400000)});
  });
  return {...result, enabled: configured.enabled};
}

async function main() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Certificaatcontrole is uitgeschakeld. Verwijder NODE_TLS_REJECT_UNAUTHORIZED=0 voordat je verdergaat.');
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--enable', '--expire'].includes(arg))) throw new Error('Gebruik [--apply] [--enable] [--expire]. Het testproject staat vast op bs-test-b94c7.');
  const key = process.env.STRIPE_SECRET_KEY;
  if (!/^sk_test_/.test(key || '')) throw new Error('Stel de Stripe-testsleutel eerst privé in.');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Stel GOOGLE_APPLICATION_CREDENTIALS in op het privé serviceaccountbestand van BS test.');
  let account;
  try { account = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')); }
  catch { throw new Error('Het privé JSON-bestand kon niet worden gelezen. Kies het oorspronkelijke gedownloade serviceaccountbestand.'); }
  if (account.project_id !== SANDBOX_PROJECT) throw new Error('Dit serviceaccount hoort niet bij BS test (bs-test-b94c7). Er is niets gewijzigd.');
  const app = initializeApp({projectId: SANDBOX_PROJECT, credential: cert(account)});
  const result = await setupSandbox({database: getFirestore(app), authentication: getAuth(app),
    stripe: new (require('stripe'))(key, {timeout: 15000, maxNetworkRetries: 1}),
    projectId: SANDBOX_PROJECT, stripeKey: key, password: process.env.SANDBOX_PASSWORD,
    apply: args.includes('--apply'), enable: args.includes('--enable'), expire: args.includes('--expire')});
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => {
  console.error(error.type?.startsWith('Stripe') ? 'Stripe kon de testinrichting niet uitvoeren. Controleer de testsleutel en verbinding privé.' : error.message);
  process.exitCode = 1;
});
module.exports = {setupSandbox};
