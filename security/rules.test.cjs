const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, runTransaction, serverTimestamp, Timestamp } = require('firebase/firestore');

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

async function billing(status) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'billing/config'), {enabled: true});
    if (status) await setDoc(doc(db, 'billingAccess/alice-uid'), status);
  });
}

test('een proefweek kan alleen met de servertijd voor het eigen gekoppelde account starten', async () => {
  await billing();
  const db = user('alice');
  await assertFails(getDoc(doc(db, 'boekingen/alice')));
  await assertFails(setDoc(doc(db, 'billingAccess/alice-uid'), {status: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() + 86400000)}));
  await assertFails(setDoc(doc(db, 'billingAccess/bob-uid'), {status: 'trial', trialStartedAt: serverTimestamp()}));
  await assertFails(setDoc(doc(user('alice', {email_verified: false}), 'billingAccess/alice-uid'), {status: 'trial', trialStartedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(db, 'billingAccess/alice-uid'), {status: 'trial', trialStartedAt: serverTimestamp()}));
  await assertSucceeds(getDoc(doc(db, 'boekingen/alice')));
  await assertSucceeds(updateDoc(doc(db, 'boekingen/alice'), {prijs: 0}));
});

test('een gebruiker kan de proefperiode niet herstarten, verlengen of als betaald markeren', async () => {
  await billing({status: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() - 8 * 86400000)});
  const db = user('alice');
  for (const patch of [{trialStartedAt: serverTimestamp()}, {status: 'lifetime'}, {status: 'free'},
    {status: 'active', validUntil: Timestamp.fromMillis(Date.now() + 86400000)}]) {
    await assertFails(updateDoc(doc(db, 'billingAccess/alice-uid'), patch));
  }
  await assertFails(deleteDoc(doc(db, 'billingAccess/alice-uid')));
  await assertFails(updateDoc(doc(db, 'billing/config'), {enabled: false}));
  await assertFails(getDoc(doc(db, 'billingAccess/bob-uid')));
});

test('een verlopen proefperiode blokkeert boekingen en instellingen maar laat eigen profiel en betaalstatus bereikbaar', async () => {
  await billing({status: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() - 8 * 86400000)});
  const db = user('alice');
  for (const path of ['boekingen/alice', 'instellingen/alice', 'pushSubscriptions/alice', 'meldingen/bericht']) {
    await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(getDocs(query(collection(db, 'boekingen'), where('gebruiker', '==', 'alice'))));
  await assertFails(setDoc(doc(db, 'boekingen/nieuw'), {gebruiker: 'alice', prijs: 0}));
  await assertFails(updateDoc(doc(db, 'boekingen/alice'), {prijs: 10}));
  await assertFails(deleteDoc(doc(db, 'boekingen/alice')));
  for (const path of ['accounts/alice', 'authUsers/alice-uid', 'billing/config', 'billingAccess/alice-uid']) {
    await assertSucceeds(getDoc(doc(db, path)));
  }
});

test('alleen geldige betaalde of vrijgestelde toegang geeft weer toegang tot bewaarde boekingen', async () => {
  for (const status of [{status: 'free'}, {status: 'lifetime'},
    {status: 'active', validUntil: Timestamp.fromMillis(Date.now() + 86400000)}]) {
    await billing(status);
    await assertSucceeds(getDoc(doc(user('alice'), 'boekingen/alice')));
  }
  for (const status of [{status: 'active', validUntil: Timestamp.fromMillis(Date.now() - 1000)},
    {status: 'pending'}]) {
    await billing(status);
    await assertFails(getDoc(doc(user('alice'), 'boekingen/alice')));
  }
});

test('de hoofdbeheerder houdt toegang; een gewone beheerder kan zichzelf geen abonnement geven', async () => {
  await billing();
  await assertSucceeds(getDoc(doc(user('alice', {admin: true}), 'boekingen/bob')));
  await assertSucceeds(setDoc(doc(user('alice', {admin: true}), 'billingAccess/bob-uid'), {status: 'lifetime'}));
  const db = user('alice', {beheerder: true});
  await assertFails(getDoc(doc(db, 'boekingen/bob')));
  await assertFails(setDoc(doc(db, 'billingAccess/alice-uid'), {status: 'free'}));
  await assertFails(updateDoc(doc(db, 'billing/config'), {enabled: false}));
});

test('interne Stripe-klanten, betaalhistorie en verwerkingssloten zijn niet rechtstreeks bereikbaar', async () => {
  for (const db of [user('alice'), user('alice', {beheerder: true}), env.unauthenticatedContext().firestore()]) {
    for (const path of ['billingCustomers/alice-uid', 'billingCheckout/alice-uid', 'billingEvents/evt_1', 'billingLocks/alice-uid-sync']) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), {status: 'paid'}));
    }
  }
});

test('een ongeldige aan-uitinstelling schakelt de betaalbeveiliging niet stilzwijgend uit', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'billing/config'), {enabled: 'true'}));
  await assertFails(getDoc(doc(user('alice'), 'boekingen/alice')));
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

test('een transactie mag afwezigheid controleren maar kan geen boeking van een ander lezen of maken', async () => {
  const db = user('alice');
  await assertSucceeds(runTransaction(db, async tx => {
    const ref = doc(db, 'boekingen', 'nieuw-document');
    const snapshot = await tx.get(ref);
    assert.equal(snapshot.exists(), false);
    tx.set(ref, { gebruiker: 'alice', prijs: 0 });
  }));
  await assertFails(runTransaction(db, async tx => { await tx.get(doc(db, 'boekingen', 'bob')); }));
  await assertFails(runTransaction(db, async tx => {
    const ref = doc(db, 'boekingen', 'vervalst-document');
    await tx.get(ref);
    tx.set(ref, { gebruiker: 'bob', prijs: 0 });
  }));
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('geen-profiel', { email_verified: true }),
    env.authenticatedContext('alice-uid', { email_verified: false })]) {
    await assertFails(getDoc(doc(context.firestore(), 'boekingen', 'niet-bestaand')));
  }
});

test('een vertrouwd gemigreerde oude naam blijft eigenaar, zonder de nieuwe naamregels te versoepelen', async () => {
  const name = 'Jos\u00e9 de Vries';
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'accounts', name), { uid: 'legacy-uid', gebruiker: name, email: 'legacy@example.test' });
    await setDoc(doc(db, 'authUsers', 'legacy-uid'), { gebruiker: name });
    await setDoc(doc(db, 'boekingen', 'oud'), { gebruiker: name, prijs: 10 });
  });
  const db = env.authenticatedContext('legacy-uid', { email: 'legacy@example.test', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'accounts', name)));
  await assertSucceeds(getDocs(query(collection(db, 'boekingen'), where('gebruiker', '==', name))));
  await assertSucceeds(updateDoc(doc(db, 'boekingen', 'oud'), { prijs: 0 }));
  await assertFails(getDoc(doc(db, 'boekingen', 'alice')));
  await assertFails(getDoc(doc(user('alice'), 'boekingen', 'oud')));
  await assertFails(signup(user('nieuw', { email_verified: false }), 'a'));
  await assertFails(signup(user('nieuw', { email_verified: false }), 'Nieuwe Naam'));
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
