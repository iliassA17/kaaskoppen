const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { migrate } = require('../../scripts/migrate-auth.cjs');

const projectId = 'demo-kaaskoppen';
const password = 'EenSterkWachtwoord!42';
let authentication, database;

test.beforeAll(() => {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Gebruik npm run test:security. Deze tests mogen uitsluitend lokale emulators benaderen.');
  }
  const app = initializeApp({ projectId }, 'browser-tests');
  authentication = getAuth(app); database = getFirestore(app);
});

async function seedUser(name = 'alice', options = {}) {
  const user = await authentication.createUser({ uid: name + '-uid', email: name + '@example.test',
    password, emailVerified: options.verified !== false });
  if (options.admin) await authentication.setCustomUserClaims(user.uid, { admin: true });
  await database.doc('accounts/' + name).set({ uid: user.uid, gebruiker: name, email: user.email });
  await database.doc('authUsers/' + user.uid).set({ gebruiker: name });
  await database.doc('boekingen/' + name).set({ gebruiker: name, datumStr: '2026-11-02', start: 600, eind: 695,
    naam: 'Eigen boeking', prijs: 0, tijdvak: 0, betaling: 'betaald' });
  return user;
}

test.beforeEach(async ({ page }) => {
  const authReset = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  const dataReset = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  expect(authReset.ok && dataReset.ok).toBeTruthy();
  page.testErrors = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
  await page.addInitScript(() => {
    window.BOEKINGEN_TEST_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-kaaskoppen.firebaseapp.com', projectId: 'demo-kaaskoppen' };
    window.emailjs = { init() {}, send: async () => {} };
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const match = /^\/firebasejs\/9\.23\.0\/(firebase-(?:app|auth|firestore)-compat\.js)$/.exec(url.pathname);
    if (url.hostname === 'www.gstatic.com' && match) {
      return route.fulfill({ contentType: 'application/javascript', body: readFileSync('node_modules/firebase-compat-sdk/' + match[1]) });
    }
    return route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(page.testErrors).toEqual([]); });

async function login(page, email = 'alice@example.test', pass = password) {
  await page.locator('#auth-user').fill(email);
  await page.locator('#auth-pass').fill(pass);
  await page.locator('#auth-btn').click();
}

async function voegTestBoekingToe(page, name = 'Nieuwe boeking') {
  await page.locator('#naam').fill(name);
  await page.locator('#datum').fill('2026-11-03');
  await page.locator('#starttijd').fill('10:00');
  await page.locator('#prijs-input').fill('0');
  await page.evaluate(() => {
    window.testOpslagFout = null;
    const original = slaOp;
    slaOp = function() {
      return original.apply(this, arguments).catch(error => {
        window.testOpslagFout = error.code || error.message;
        throw error;
      });
    };
  });
  await page.locator('#add-btn').click();
  await expect.poll(() => page.evaluate(() => boekingOpslaanBezig)).toBe(false);
  expect(await page.evaluate(() => window.testOpslagFout)).toBeNull();
  await expect(page.locator('#logboek')).toContainText('toegevoegd');
}

test('nieuwe boeking bewaren werkt ook naast een oud veld dat niet aan de nieuwe regels voldoet', async ({ page }) => {
  await seedUser();
  await database.doc('boekingen/alice').update({ platform: null });
  const oldBooking = (await database.doc('boekingen/alice').get()).data();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await voegTestBoekingToe(page);
  expect((await database.doc('boekingen/alice').get()).data()).toEqual(oldBooking);
  const saved = await database.collection('boekingen').where('naam', '==', 'Nieuwe boeking').get();
  expect(saved.size).toBe(1);
  expect(saved.docs[0].data().prijs).toBe(0);
  expect(saved.docs[0].data()._documentId).toBeUndefined();
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => boekingen.filter(b => b.naam === 'Nieuwe boeking').map(b => b.prijs))).toEqual([0]);
});

test('toevoegen naast 502 bestaande boekingen wijzigt uitsluitend de nieuwe boeking', async ({ page }) => {
  await seedUser();
  for (let offset = 0; offset < 501; offset += 200) {
    const batch = database.batch();
    for (let i = offset; i < Math.min(offset + 200, 501); i++) {
      const date = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
      batch.set(database.doc('boekingen/oud-' + i), { gebruiker: 'alice', datumStr: date, start: 600, eind: 695,
        naam: 'Bestaand ' + i, prijs: 10, tijdvak: 0, betaling: 'betaald' });
    }
    await batch.commit();
  }
  const oldVersion = (await database.doc('boekingen/alice').get()).updateTime;
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => boekingen.length)).toBe(502);
  await voegTestBoekingToe(page);
  expect((await database.doc('boekingen/alice').get()).updateTime.isEqual(oldVersion)).toBe(true);
  expect((await database.collection('boekingen').where('gebruiker', '==', 'alice').get()).size).toBe(503);
});

test('toevoegen overschrijft of verwijdert geen andere wijzigingen van een tweede apparaat', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await database.doc('boekingen/alice').update({ naam: 'Op ander apparaat gewijzigd' });
  await database.doc('boekingen/ander-apparaat').set({ gebruiker: 'alice', datumStr: '2026-11-04', start: 600,
    eind: 695, naam: 'Op ander apparaat toegevoegd', prijs: 10, tijdvak: 0, betaling: 'betaald' });
  await voegTestBoekingToe(page);
  expect((await database.doc('boekingen/alice').get()).data().naam).toBe('Op ander apparaat gewijzigd');
  expect((await database.doc('boekingen/ander-apparaat').get()).exists).toBe(true);
});

test('bewerken behoudt het document-ID en nulprijs, en verwijderen en ongedaan maken blijven werken', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => openBewerkModal('2026-11-02', 600, 0));
  await page.locator('#bewerk-tijd').fill('12:00');
  await page.locator('#bewerk-prijs').fill('0');
  await page.locator('#bewerk-opslaan-btn').click();
  await expect(page.locator('#bewerk-overlay')).toBeHidden();
  const edited = (await database.doc('boekingen/alice').get()).data();
  expect(edited.start).toBe(720);
  expect(edited.prijs).toBe(0);
  expect(edited._documentId).toBeUndefined();
  await page.evaluate(() => verwijderBoeking('2026-11-02', 720, 0));
  expect((await database.doc('boekingen/alice').get()).exists).toBe(false);
  await page.evaluate(() => ongedaanMaken());
  expect((await database.doc('boekingen/alice').get()).data()).toEqual(edited);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => boekingen.map(b => [b.start, b.prijs]))).toEqual([[720, 0]]);
});

test('een gelijktijdig gewijzigde boeking geeft een duidelijke melding en wordt niet overschreven', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await database.doc('boekingen/alice').update({ naam: 'Actuele naam' });
  await page.evaluate(() => openBewerkModal('2026-11-02', 600, 0));
  await page.locator('#bewerk-naam').fill('Verouderde wijziging');
  await page.locator('#bewerk-opslaan-btn').click();
  await expect(page.locator('#bewerk-error')).toContainText('inmiddels gewijzigd');
  expect((await database.doc('boekingen/alice').get()).data().naam).toBe('Actuele naam');
});

test('een geweigerde boeking toont een rechtenmelding en laat de database ongewijzigd', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#datum').fill('2026-11-03');
  await page.locator('#starttijd').fill('10:00');
  await page.locator('#naam').fill('x'.repeat(501));
  await page.locator('#add-btn').click();
  await expect(page.locator('#logboek')).toContainText('permission-denied');
  expect((await database.collection('boekingen').get()).size).toBe(1);
  expect(await page.evaluate(() => boekingen.length)).toBe(1);
});

test('een vervalste oude browsersessie geeft geen toegang', async ({ page }) => {
  await seedUser();
  await page.addInitScript(() => localStorage.setItem('auth_sessie', 'alice'));
  await page.goto('/');
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => huidigeGebruiker)).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('auth_sessie'))).toBeNull();
  const code = await page.evaluate(() => db.doc('boekingen/alice').get().then(() => 'toegestaan', error => error.code));
  expect(code).toBe('permission-denied');
});

test('geverifieerd inloggen, sessieherstel en uitloggen gebruiken Firebase', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#auth-overlay')).toBeHidden();
  expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
  await expect(page.locator('#menu-beheer')).toBeHidden();
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => auth.currentUser.uid)).toBe('alice-uid');
  await page.evaluate(() => uitloggen());
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  expect(await page.evaluate(() => boekingen)).toEqual([]);
});

test('een oude naam met hoofdletters, spaties en accent werkt na migratie en behoudt boekingen', async ({ page }) => {
  const name = 'Jos\u00e9 de Vries';
  await database.collection('accounts').doc(name).set({ gebruiker: name, email: 'legacy@example.test', hash: 'oude-hash' });
  await database.doc('boekingen/bestaand').set({ gebruiker: name, datumStr: '2026-11-02', start: 600, eind: 695,
    naam: 'Eigen boeking', prijs: 0, tijdvak: 0, betaling: 'betaald' });
  await migrate({ database, authentication, apply: true });
  const migrated = await authentication.getUserByEmail('legacy@example.test');
  await authentication.updateUser(migrated.uid, { password, emailVerified: true });
  await page.goto('/');
  await login(page, 'legacy@example.test');
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => huidigeGebruiker)).toBe(name);
  expect(await page.evaluate(() => boekingen.map(b => [b.gebruiker, b.prijs]))).toEqual([[name, 0]]);
  await voegTestBoekingToe(page);
  expect((await database.collection('boekingen').where('gebruiker', '==', name).get()).size).toBe(2);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => huidigeGebruiker)).toBe(name);
  expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
});

test('verkeerd wachtwoord en onbevestigde e-mail houden de app gesloten', async ({ page }) => {
  await seedUser('alice', { verified: false });
  await page.goto('/');
  await login(page, 'alice@example.test', 'VerkeerdWachtwoord');
  await expect(page.locator('#auth-error')).toContainText('niet gelukt');
  await login(page);
  await expect(page.locator('#auth-error')).toContainText('Bevestig eerst');
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#verificatie-opnieuw')).toBeVisible();
  await expect.poll(() => page.evaluate(() => auth.currentUser)).toBeNull();
});

test('registratie vereist uitnodiging en e-mailverificatie voordat gegevens toegankelijk zijn', async ({ page }) => {
  await database.doc('codes/UITNODIGING-123').set({ code: 'UITNODIGING-123', gebruikt: false, gebruiker: null });
  await page.goto('/');
  await page.locator('#auth-wissel').click();
  await page.locator('#auth-user').fill('nieuw');
  await page.locator('#auth-email').fill('nieuw@example.test');
  await page.locator('#auth-pass').fill(password);
  await page.locator('#auth-pass2').fill(password);
  await page.locator('#auth-code').fill('UITNODIGING-123');
  await page.locator('#auth-btn').click();
  await expect(page.locator('#auth-success')).toContainText('Account aangemaakt');
  await expect(page.locator('#app')).toBeHidden();
  const user = await authentication.getUserByEmail('nieuw@example.test');
  expect(user.emailVerified).toBe(false);
  expect((await database.doc('accounts/nieuw').get()).data().hash).toBeUndefined();
  const messages = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`)).json();
  const verification = messages.oobCodes.find(code => code.email === user.email && code.requestType === 'VERIFY_EMAIL');
  expect(verification).toBeTruthy();
  await page.evaluate(code => auth.applyActionCode(code), verification.oobCode);
  await page.locator('#auth-wissel').click();
  await login(page, user.email);
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => huidigeGebruiker)).toBe('nieuw');
});

test('wachtwoordherstel gebruikt een Firebase-resetcode en het nieuwe wachtwoord werkt', async ({ page }) => {
  await seedUser();
  await page.goto('/');
  await page.locator('#vergeten-link').click();
  await page.locator('#vergeten-user').fill('alice@example.test');
  await page.locator('#vergeten-btn').click();
  await expect(page.locator('#vergeten-success')).toContainText('Als dit e-mailadres');
  const messages = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`)).json();
  const reset = messages.oobCodes.find(code => code.email === 'alice@example.test' && code.requestType === 'PASSWORD_RESET');
  expect(reset).toBeTruthy();
  await page.evaluate(code => auth.confirmPasswordReset(code, 'EenNieuwWachtwoord!99'), reset.oobCode);
  await page.locator('#vergeten-terug').click();
  await login(page, 'alice@example.test', 'EenNieuwWachtwoord!99');
  await expect(page.locator('#app')).toBeVisible();
});

test('een persoonlijk admin-token opent beheer zonder gedeeld beheerderswachtwoord', async ({ page }) => {
  await seedUser('root', { admin: true });
  await page.goto('/');
  await login(page, 'root@example.test');
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => openBeheerPagina());
  await expect(page.locator('#admin-panel')).toBeVisible();
  await expect(page.locator('#admin-pass')).toHaveCount(0);
});

test('na wisselen van account worden alleen de boekingen van de nieuwe gebruiker geladen', async ({ page }) => {
  await seedUser('alice');
  await seedUser('bob');
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => boekingen.map(b => b.gebruiker))).toEqual(['alice']);
  await page.evaluate(() => uitloggen());
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await login(page, 'bob@example.test');
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => boekingen.map(b => b.gebruiker))).toEqual(['bob']);
  expect(await page.evaluate(() => db.doc('boekingen/alice').get().then(() => 'toegestaan', error => error.code))).toBe('permission-denied');
});
