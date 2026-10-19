const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, runTransaction } = require('firebase/firestore');

let env;
const user = (name, extra = {}) => env.authenticatedContext(name + '-uid', {
  email: name + '@example.test', email_verified: true, ...extra,
}).firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-kaaskoppen',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const name of ['alice', 'bob']) {
      await setDoc(doc(db, 'accounts', name), { uid: name + '-uid', gebruiker: name, email: name + '@example.test' });
      await setDoc(doc(db, 'authUsers', name + '-uid'), { gebruiker: name });
      await setDoc(doc(db, 'boekingen', name), { gebruiker: name, prijs: 0 });
      await setDoc(doc(db, 'instellingen', name), { minGap: 95 });
      await setDoc(doc(db, 'pushSubscriptions', name), { gebruiker: name, subscription: {} });
    }
    await setDoc(doc(db, 'codes', 'UITNODIGING-123'), { code: 'UITNODIGING-123', gebruikt: false, gebruiker: null });
    await setDoc(doc(db, 'resets', 'alice'), { code: 'oud' });
    await setDoc(doc(db, 'meldingen', 'bericht'), { gebruiker: 'bob', titel: 'Vraag', inhoud: 'Inhoud', stemmen: { bob: 'voor' } });
  });
});

test('zonder login zijn accountgegevens, boekingen en instellingen niet leesbaar', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const path of ['accounts/alice', 'boekingen/alice', 'instellingen/alice', 'pushSubscriptions/alice', 'authUsers/alice-uid']) {
    await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(setDoc(doc(db, 'boekingen', 'nieuw'), { gebruiker: 'alice' }));
});

test('een onbevestigd e-mailadres geeft geen toegang tot bestaande gegevens', async () => {
  const db = user('alice', { email_verified: false });
  for (const path of ['accounts/alice', 'boekingen/alice', 'instellingen/alice', 'pushSubscriptions/alice']) {
    await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(setDoc(doc(db, 'boekingen', 'nieuw'), { gebruiker: 'alice' }));
});

test('een gebruiker kan de eigen boekingen inclusief nulprijs lezen en bewaren', async () => {
  const db = user('alice');
  await assertSucceeds(getDoc(doc(db, 'boekingen', 'alice')));
  await assertSucceeds(updateDoc(doc(db, 'boekingen', 'alice'), { prijs: 0 }));
  await assertSucceeds(getDocs(query(collection(db, 'boekingen'), where('gebruiker', '==', 'alice'))));
  await assertSucceeds(setDoc(doc(db, 'instellingen', 'alice'), { standaardPrijs: 0 }));
});

test('een ander account, andere filters en een onbeperkte zoekopdracht geven geen toegang', async () => {
  const db = user('alice');
  for (const path of ['accounts/bob', 'boekingen/bob', 'instellingen/bob', 'pushSubscriptions/bob']) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(deleteDoc(doc(db, path)));
  }
  await assertFails(getDocs(collection(db, 'boekingen')));
  await assertFails(getDocs(query(collection(db, 'boekingen'), where('gebruiker', '==', 'bob'))));
  await assertFails(updateDoc(doc(db, 'boekingen', 'alice'), { gebruiker: 'bob' }));
  await assertFails(setDoc(doc(db, 'boekingen', 'vervalst'), { gebruiker: 'bob' }));
});

test('profielwijzigingen kunnen geen wachtwoord, eigenaar of beheerdersrechten veranderen', async () => {
  const db = user('alice');
  await assertSucceeds(updateDoc(doc(db, 'accounts', 'alice'), { ranglijstPrive: true }));
  for (const fields of [{ uid: 'bob-uid' }, { gebruiker: 'bob' }, { email: 'bob@example.test' }, { hash: 'vervalst' }, { isBeheerder: true }, { admin: true }]) {
    await assertFails(updateDoc(doc(db, 'accounts', 'alice'), fields));
  }
  await assertFails(setDoc(doc(db, 'authUsers', 'alice-uid'), { gebruiker: 'bob' }));
  await assertFails(updateDoc(doc(db, 'accounts', 'alice'), { foto: '" onerror="alert(1)' }));
});

test('alleen vertrouwde beheerdersclaims geven beheerrechten', async () => {
  await assertFails(getDocs(collection(user('alice', { isBeheerder: true }), 'accounts')));
  await assertSucceeds(getDocs(collection(user('root', { admin: true }), 'accounts')));
  await assertSucceeds(getDocs(collection(user('staff', { beheerder: true }), 'boekingen')));
  await assertFails(setDoc(doc(user('alice'), 'codes', 'NIEUWE-CODE'), { code: 'NIEUWE-CODE', gebruikt: false, gebruiker: null }));
  await assertSucceeds(setDoc(doc(user('staff', { beheerder: true }), 'codes', 'NIEUWE-CODE'), { code: 'NIEUWE-CODE', gebruikt: false, gebruiker: null }));
});

async function signup(db, name = 'nieuw', code = 'UITNODIGING-123', extra = {}) {
  await runTransaction(db, async tx => {
    await tx.get(doc(db, 'codes', code));
    tx.set(doc(db, 'accounts', name), {
      uid: 'nieuw-uid', gebruiker: name, email: 'nieuw@example.test', aangemaakt: 'vandaag', uitnodigingscode: code, ...extra,
    });
    tx.set(doc(db, 'authUsers', 'nieuw-uid'), { gebruiker: name });
    tx.update(doc(db, 'codes', code), { gebruikt: true, gebruiker: name, uid: 'nieuw-uid' });
  });
}

test('registratie koppelt uitnodiging, UID en gebruikersnaam in één transactie', async () => {
  const db = user('nieuw', { email_verified: false });
  await assertSucceeds(signup(db));
  await assertFails(signup(db, 'tweede'));
  const verified = user('nieuw');
  const profile = await assertSucceeds(getDoc(doc(verified, 'accounts', 'nieuw')));
  assert.equal(profile.data().uid, 'nieuw-uid');
  await assertFails(getDocs(collection(db, 'codes')));
});

test('registratie kan geen bestaande naam overnemen of zichzelf beheerder maken', async () => {
  await assertFails(signup(user('nieuw', { email_verified: false }), 'alice'));
  await assertFails(signup(user('nieuw', { email_verified: false }), 'nieuw', 'UITNODIGING-123', { isBeheerder: true }));
  await assertFails(setDoc(doc(user('nieuw'), 'accounts', 'nieuw'), { uid: 'nieuw-uid', gebruiker: 'nieuw' }));
  await assertFails(updateDoc(doc(user('nieuw'), 'codes', 'UITNODIGING-123'), { gebruikt: true, gebruiker: 'nieuw', uid: 'nieuw-uid' }));
});

test('oude resetcodes en onbekende verzamelingen zijn altijd afgesloten', async () => {
  for (const db of [user('alice'), user('root', { admin: true })]) {
    await assertFails(getDoc(doc(db, 'resets', 'alice')));
    await assertFails(setDoc(doc(db, 'resets', 'alice'), { code: 'nieuw' }));
    await assertFails(setDoc(doc(db, 'roles', 'alice'), { admin: true }));
  }
});

test('een gebruiker kan alleen de eigen stem wijzigen en geen nieuws publiceren', async () => {
  const db = user('alice');
  await assertSucceeds(updateDoc(doc(db, 'meldingen', 'bericht'), { stemmen: { bob: 'voor', alice: 'tegen' } }));
  await assertFails(updateDoc(doc(db, 'meldingen', 'bericht'), { stemmen: { bob: 'tegen', alice: 'tegen' } }));
  await assertFails(setDoc(doc(db, 'updates', 'bericht'), { titel: 'Vervalst' }));
});

test('boekingsvelden kunnen geen scriptcode naar het beheerscherm doorsluizen', async () => {
  const db = user('alice');
  for (const fields of [{ datumStr: "2026-11-02');alert(1);//" }, { start: 'alert(1)' },
    { tijdvak: 'alert(1)' }, { platform: '<img src=x onerror=alert(1)>' }, { betaling: '<script>' }]) {
    await assertFails(updateDoc(doc(db, 'boekingen', 'alice'), fields));
  }
});
