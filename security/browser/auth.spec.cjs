const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
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
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const endpoint = /^\/api\/(subscription-status|create-checkout-session|create-portal-session|billing-overview|ranking|schedule-preview)$/.exec(url.pathname);
    if (url.hostname === '127.0.0.1' && endpoint) {
      const request = route.request();
      const result = await require('../../netlify/functions/' + endpoint[1] + '.js').handler({
        httpMethod: request.method(), headers: await request.allHeaders(), body: request.postData() || ''
      });
      return route.fulfill({status: result.statusCode, headers: result.headers, body: result.body});
    }
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

async function enableTrial(started) {
  await database.doc('billing/config').set({enabled: true, taxIncluded: true,
    provider: 'stripe', plans: {maand: {amountCents: 799}, halfjaar: {amountCents: 3999}, jaar: {amountCents: 5999}, levenslang: {amountCents: 9999}}});
  if (started) await database.doc('billingAccess/alice-uid').set({status: 'trial', trialStartedAt: Timestamp.fromMillis(started)});
}

function billingFixture() {
  const date = Date.UTC(2026, 10, 21, 12);
  return {access: {allowed: true, kind: 'active', expiresAt: date}, hasCustomer: true, taxIncluded: true,
    subscription: {plan: 'maand', label: 'Per maand', amountCents: 799, currency: 'EUR', status: 'active',
      currentPeriodEnd: date, nextPaymentAt: date, cancelAtPeriodEnd: false}, nextCursor: null,
    invoices: [
      {id: 'in_open', number: 'BS-2026-002', status: 'open', totalCents: 799, paidCents: 0, remainingCents: 799,
        currency: 'EUR', createdAt: date - 86400000, dueAt: date, pdfUrl: 'https://pay.stripe.com/invoice/open/pdf',
        paymentUrl: 'https://invoice.stripe.com/i/open'},
      {id: 'in_paid', number: 'BS-2026-001', status: 'paid', totalCents: 799, paidCents: 799, remainingCents: 0,
        currency: 'EUR', createdAt: date - 31 * 86400000, paidAt: date - 30 * 86400000,
        pdfUrl: 'https://pay.stripe.com/invoice/paid/pdf', paymentUrl: 'https://invoice.stripe.com/i/paid'},
    ]};
}

test('abonnement beheren staat in het menu en toont eigen betaalstatus, datums, PDF’s en volgende betaling', async ({page}) => {
  await seedUser(); await enableTrial();
  const fixture = billingFixture(); let requestedAfter = null;
  fixture.nextCursor = 'in_paid';
  await page.route('**/api/billing-overview', async route => {
    expect(await route.request().headerValue('authorization')).toMatch(/^Bearer /);
    const body = route.request().postDataJSON(); requestedAfter = body.after;
    const data = body.after ? {...fixture, invoices: [{...fixture.invoices[1], id: 'in_older', number: 'BS-2026-000'}], nextCursor: null} : fixture;
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#hamburger-btn').click();
  await page.locator('#menu-abonnement').click();
  await expect(page.locator('#menu-bar')).toBeHidden();
  await expect(page.locator('#pagina-abonnement')).toBeVisible();
  await expect(page.locator('#abonnement-huidig-naam')).toHaveText('Per maand');
  await expect(page.locator('#abonnement-volgend-datum')).toContainText('21 november 2026');
  await expect(page.locator('.factuur-kaart')).toHaveCount(2);
  await expect(page.locator('.factuur-status.openstaand')).toHaveText('Nog te betalen');
  await expect(page.locator('.factuur-kaart').last()).toContainText('Betaald op');
  await expect(page.getByRole('link', {name: 'Download factuur (PDF)'}).first()).toHaveAttribute('href', fixture.invoices[0].pdfUrl);
  await expect(page.getByRole('link', {name: 'Factuur betalen'})).toHaveAttribute('href', fixture.invoices[0].paymentUrl);
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.locator('#abonnement-pagina-titel').boundingBox()).y).toBeGreaterThanOrEqual(28);
  await page.screenshot({path: test.info().outputPath('abonnement-beheer-mobiel.png'), fullPage: true, animations: 'disabled'});
  await page.setViewportSize({width: 1365, height: 1050});
  await page.screenshot({path: test.info().outputPath('abonnement-beheer.png'), fullPage: true, animations: 'disabled'});
  await page.locator('#abonnement-facturen-meer').click();
  await expect(page.locator('.factuur-kaart')).toHaveCount(3);
  expect(requestedAfter).toBe('in_paid');
  await expect(page.locator('#abonnement-facturen-meer')).toBeHidden();
  await page.reload();
  await expect(page.locator('#pagina-abonnement')).toBeVisible();
  await page.locator('#abonnement-pagina-terug').click();
  await expect(page.locator('#app')).toBeVisible();
});

test('een betaalde jaarperiode blijft bruikbaar nadat het Stripe-abonnement is opgezegd', async ({page}) => {
  await seedUser(); await enableTrial();
  const end = Date.UTC(2029, 11, 23, 12);
  await database.doc('billingAccess/alice-uid').set({status: 'active', validUntil: Timestamp.fromMillis(end)});
  const fixture = billingFixture();
  fixture.access = {allowed: true, kind: 'active', expiresAt: end};
  fixture.subscription = {plan: 'jaar', label: 'Per jaar', amountCents: 5999, currency: 'EUR',
    status: 'canceled', currentPeriodEnd: end - 365 * 86400000, nextPaymentAt: null, cancelAtPeriodEnd: false};
  fixture.invoices = [{...fixture.invoices[1], totalCents: 5999, paidCents: 5999}];
  await page.route('**/api/billing-overview', route => route.fulfill({status: 200,
    contentType: 'application/json', body: JSON.stringify(fixture)}));
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#hamburger-btn').click(); await page.locator('#menu-abonnement').click();
  await expect(page.locator('#abonnement-huidig-status')).toHaveText('Betaalde toegang · opgezegd');
  await expect(page.locator('#abonnement-huidig-periode')).toContainText('23 december 2029');
  await expect(page.locator('#abonnement-huidig-periode')).toContainText('niet automatisch verlengd');
  await expect(page.locator('#abonnement-volgend-bedrag')).toHaveText('Geen betaling gepland');
  await expect(page.locator('#abonnement-volgend-uitleg')).toHaveText('Je abonnement wordt niet opnieuw verlengd.');
  await expect(page.getByRole('link', {name: 'Factuur betalen'})).toHaveCount(0);
  await page.locator('#abonnement-pagina-terug').click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeHidden();
});

test('proefgebruikers zien een helder leeg factuuroverzicht en kunnen bij een storing opnieuw ophalen', async ({page}) => {
  await seedUser(); await enableTrial();
  let attempts = 0;
  await page.route('**/api/billing-overview', async route => {
    attempts++;
    return route.fulfill({status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ?
      {error: 'Facturen zijn tijdelijk niet beschikbaar.'} :
      {access: {allowed: true, kind: 'trial', expiresAt: Date.now() + 86400000}, subscription: null, invoices: [], nextCursor: null, hasCustomer: false})});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => openAbonnementOverzicht());
  await expect(page.locator('#abonnement-overzicht-fout')).toContainText('tijdelijk');
  await page.locator('#abonnement-overzicht-verversen').click();
  await expect(page.locator('#abonnement-huidig-naam')).toHaveText('Gratis proefweek');
  await expect(page.locator('#abonnement-facturen-leeg')).toContainText('Tijdens je gratis proefweek');
  await expect(page.locator('#abonnement-portaal-openen')).toBeHidden();
});

test('in de proefweek staan alle prijzen, besparingen en vooruitbetalen op de abonnementspagina', async ({page}) => {
  await seedUser(); await enableTrial();
  const expiresAt = Date.now() + 3 * 86400000;
  const plans = require('../../subscription-access.js').planOptions({plans: {
    maand: {amountCents: 799}, halfjaar: {amountCents: 3999}, jaar: {amountCents: 5999}, levenslang: {amountCents: 9999}
  }});
  await page.route('**/api/billing-overview', route => route.fulfill({status: 200, contentType: 'application/json',
    body: JSON.stringify({access: {allowed: true, kind: 'trial', expiresAt}, plans, taxIncluded: true,
      subscription: null, invoices: [], nextCursor: null, hasCustomer: false})}));
  let chosen;
  await page.route('**/api/create-checkout-session', route => {
    chosen = route.request().postDataJSON();
    return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Probeer opnieuw.'})});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#hamburger-btn').click();
  await page.locator('#menu-abonnement').click();
  const cards = page.locator('#abonnement-proefweek-opties .abonnement-optie');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('7,99');
  await expect(cards.nth(1)).toContainText('39,99');
  await expect(cards.nth(1)).toContainText('6,67');
  await expect(cards.nth(2)).toContainText('59,99');
  await expect(cards.nth(3)).toContainText('99,99');
  await expect(page.locator('#abonnement-proefweek-uitleg')).toContainText('geen proefdagen');
  await page.screenshot({path: test.info().outputPath('proefweek-betaalopties.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: test.info().outputPath('proefweek-betaalopties-mobiel.png'), fullPage: true});
  await cards.nth(1).getByRole('button').click();
  await expect(page.locator('#abonnement-overzicht-fout')).toHaveText('Probeer opnieuw.');
  expect(chosen).toEqual({plan: 'halfjaar'});
  await expect(cards.nth(1).getByRole('button')).toBeEnabled();
  await page.locator('#abonnement-pagina-terug').click();
  await expect(page.locator('#app')).toBeVisible();
});

test('een vooruitbetaalde proefweek toont de gekozen periode en geen tweede koopknoppen', async ({page}) => {
  await seedUser(); await enableTrial();
  const start = Date.UTC(2027, 0, 31, 12), end = Date.UTC(2027, 6, 31, 12);
  const fixture = billingFixture();
  fixture.access = {allowed: true, kind: 'trial', expiresAt: start};
  fixture.prepaid = {startsAt: start, endsAt: end};
  fixture.plans = require('../../subscription-access.js').planOptions({plans: {maand: {amountCents: 799}}});
  fixture.subscription = {plan: 'halfjaar', label: 'Per halfjaar', amountCents: 3999, currency: 'EUR',
    status: 'trialing', currentPeriodEnd: end, nextPaymentAt: end, cancelAtPeriodEnd: false};
  fixture.invoices = [];
  await page.route('**/api/billing-overview', route => route.fulfill({status: 200,
    contentType: 'application/json', body: JSON.stringify(fixture)}));
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => openAbonnementOverzicht());
  await expect(page.locator('#abonnement-huidig-status')).toHaveText('Vooruitbetaald · proefweek actief');
  await expect(page.locator('#abonnement-huidig-periode')).toContainText('31 januari 2027');
  await expect(page.locator('#abonnement-huidig-periode')).toContainText('31 juli 2027');
  await expect(page.locator('#abonnement-volgend-datum')).toContainText('31 juli 2027');
  await expect(page.locator('#abonnement-proefweek-keuzes')).toBeHidden();
  await expect(page.locator('#abonnement-betaalopties-openen')).toBeHidden();
  fixture.access = {allowed: true, kind: 'active', expiresAt: end};
  await page.locator('#abonnement-overzicht-verversen').click();
  await expect(page.locator('#abonnement-huidig-status')).toHaveText('Actief');
  await expect(page.locator('#abonnement-huidig-periode')).toContainText('31 juli 2027');
});

test('verlopen gebruikers kunnen facturen openen zonder de boekingsblokkade te omzeilen', async ({page}) => {
  await seedUser(); await enableTrial(Date.now() - 8 * 86400000);
  const data = billingFixture(); data.access = {allowed: false, kind: 'expired', expiresAt: Date.now() - 1000};
  data.invoices[0].number = '<img src=x onerror=alert(1)>';
  data.invoices[0].pdfUrl = 'javascript:alert(1)';
  await page.route('**/api/billing-overview', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)}));
  await page.goto('/'); await login(page);
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  await page.locator('#abonnement-beheren').click();
  await expect(page.locator('#pagina-abonnement')).toBeVisible();
  await expect(page.locator('.factuur-kaart')).toHaveCount(2);
  await expect(page.locator('.factuur-kaart').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.factuur-kaart img')).toHaveCount(0);
  await expect(page.locator('.factuur-kaart').first().getByRole('link', {name: 'Download factuur (PDF)'})).toHaveCount(0);
  await expect(page.locator('#hamburger-btn-abonnement')).toBeHidden();
  await expect(page.locator('#app')).toBeHidden();
  await page.locator('#abonnement-pagina-terug').click();
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});

test('een factuurantwoord na uitloggen verschijnt nooit in de volgende sessie', async ({page}) => {
  await seedUser(); await enableTrial();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/api/billing-overview', async route => {
    await wait;
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(billingFixture())});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => { openAbonnementOverzicht(); });
  await expect(page.locator('#abonnement-overzicht-laden')).toBeVisible();
  await page.evaluate(() => auth.signOut());
  await expect(page.locator('#auth-overlay')).toBeVisible();
  release();
  await expect(page.locator('#pagina-abonnement')).toBeHidden();
  await expect(page.locator('.factuur-kaart')).toHaveCount(0);
});

test('de eerste bevestigde login start een proefweek; herladen start geen nieuwe week', async ({ page }) => {
  await seedUser();
  await enableTrial();
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeHidden();
  await voegTestBoekingToe(page);
  const original = (await database.doc('billingAccess/alice-uid').get()).data();
  expect(original.status).toBe('trial');
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect((await database.doc('billingAccess/alice-uid').get()).data()).toEqual(original);
});

test('na afloop verschijnt het centrale keuzescherm met vier opties en blijft de database beschermd', async ({ page }) => {
  await seedUser();
  await enableTrial(Date.now() - 8 * 86400000);
  await page.goto('/');
  await login(page);
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#abonnement-titel')).toContainText('afgelopen');
  await expect(page.locator('.abonnement-optie h3')).toHaveText(['Per maand', 'Per halfjaar', 'Per jaar', 'Voor altijd']);
  await expect(page.locator('.abonnement-prijs').first()).toContainText('7,99');
  await expect(page.locator('#abonnement-achtergrond')).toBeVisible();
  await expect(page.locator('#abonnement-achtergrond')).toHaveAttribute('inert', '');
  await expect(page.locator('#abonnement-achtergrond-afbeelding')).toHaveAttribute('src', /^blob:/);
  const desktopCards = await page.locator('#abonnement-opties .abonnement-optie').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect(); return {x: box.x, y: box.y};
  }));
  expect(new Set(desktopCards.map(card => Math.round(card.y))).size).toBe(1);
  expect(desktopCards[3].x).toBeGreaterThan(desktopCards[0].x);
  await page.keyboard.press('Escape');
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  const box = await page.locator('#abonnement-dialoog').boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
  await page.screenshot({path: test.info().outputPath('abonnement-keuze.png')});
  const code = await page.evaluate(() => db.doc('boekingen/alice').get({source: 'server'}).then(() => 'toegestaan', error => error.code));
  expect(code).toBe('permission-denied');
  await page.locator('[data-plan="levenslang"]').click();
  await expect(page.locator('#abonnement-error')).toContainText('nog niet ingesteld');
  expect((await database.doc('billingAccess/alice-uid').get()).data().status).toBe('trial');
  await page.setViewportSize({width: 390, height: 844});
  const mobileBox = await page.locator('#abonnement-dialoog').boundingBox();
  expect(mobileBox.width).toBeLessThanOrEqual(390);
  const mobileCards = await page.locator('#abonnement-opties .abonnement-optie').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect(); return {x: box.x, y: box.y};
  }));
  expect(new Set(mobileCards.map(card => Math.round(card.x))).size).toBe(1);
  expect(mobileCards[3].y).toBeGreaterThan(mobileCards[0].y);
  await page.screenshot({path: test.info().outputPath('abonnement-keuze-mobiel.png')});
  await page.locator('#abonnement-uitloggen').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeHidden();
  await expect(page.locator('#abonnement-achtergrond')).toBeHidden();
  await expect(page.locator('#abonnement-achtergrond-afbeelding')).not.toHaveAttribute('src');
});

test('nieuwe gebruikers openen de ranglijst zonder privéaccounts of inactieve anderen te kunnen ophalen', async ({page}) => {
  await seedUser(); await seedUser('bob'); await seedUser('carol'); await seedUser('dave'); await enableTrial();
  await seedUser('erin'); await seedUser('frank');
  const today = require('../../netlify/lib/private-view.cjs').dayString(Date.now());
  await database.doc('boekingen/bob').update({datumStr: today, prijs: 30});
  await database.doc('boekingen/erin').update({datumStr: today, prijs: 20});
  await database.doc('boekingen/frank').update({datumStr: today, prijs: 10});
  await database.doc('boekingen/carol').update({datumStr: today});
  await database.doc('accounts/carol').update({ranglijstPrive: true});
  await database.doc('boekingen/alice').update({datumStr: '2020-01-01'});
  await database.doc('boekingen/dave').update({datumStr: '2020-01-01'});
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#hamburger-btn').click();
  await expect(page.locator('#menu-ranglijst')).toBeVisible();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ranking');
  await page.locator('#menu-ranglijst').click();
  const data = await (await response).json();
  expect(JSON.stringify(data)).not.toMatch(/carol|dave|example.test|alice-uid/);
  await expect(page.locator('.ranglijst-kaart')).toHaveCount(4);
  await expect(page.locator('.ranglijst-kaart:not(.ranglijst-eigen-inactief) .ranglijst-positie')).toHaveText(['🥇', '🥈', '🥉']);
  await expect(page.locator('[data-username="bob"]')).toHaveCSS('border-top-color', 'rgb(232, 201, 122)');
  await expect(page.locator('[data-username="bob"] .ranglijst-cijfers')).toContainText('🏆');
  await expect(page.locator('.ranglijst-eigen-inactief')).toContainText('@alice · Jij');
  await expect(page.locator('.ranglijst-eigen-inactief')).toContainText('alleen jij');
  await expect(page.locator('[data-username="bob"]')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('ranglijst-oude-vormgeving.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: test.info().outputPath('ranglijst-oude-vormgeving-mobiel.png'), fullPage: true});
  expect(await page.evaluate(() => db.collection('accounts').get().then(() => 'toegestaan', e => e.code))).toBe('permission-denied');
  await database.doc('accounts/bob').update({ranglijstPrive: true});
  await page.locator('#ranglijst-inhoud').getByRole('button', {name: /^dag$/i}).click();
  await expect(page.locator('.ranglijst-kaart')).toHaveCount(3);
  await expect(page.locator('[data-username="bob"]')).toHaveCount(0);
  await page.screenshot({path: test.info().outputPath('ranglijst-eigen-inactief.png')});
  await page.evaluate(() => auth.signOut());
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await expect(page.locator('.ranglijst-kaart')).toHaveCount(0);
});

test('een late kalenderafbeelding verschijnt niet na uitloggen of bij een ander account', async ({page}) => {
  await seedUser(); await seedUser('bob'); await enableTrial(Date.now() - 8 * 86400000);
  await database.doc('billingAccess/bob-uid').set({status: 'free'});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/schedule-preview', async route => {
    await gate;
    await route.fulfill({status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><text>ALICE-PLANNING</text></svg>'}).catch(() => {});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  await page.locator('#abonnement-uitloggen').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await login(page, 'bob@example.test');
  await expect(page.locator('#app')).toBeVisible();
  release();
  await expect(page.locator('#abonnement-achtergrond')).toBeHidden();
  await expect(page.locator('#abonnement-achtergrond-afbeelding')).not.toHaveAttribute('src');
});

test('de proefperiode verloopt ook terwijl de app open blijft; toegang herstelt na een vertrouwde toekenning', async ({ page }) => {
  await seedUser();
  await enableTrial(Date.now() - 7 * 86400000 + 10000);
  await page.goto('/');
  await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeVisible({timeout: 15000});
  await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => boekingen)).toEqual([]);
  // A compat SDK listener can return an already downloaded snapshot, including
  // one marked fromCache=false. Use a fresh REST request to test new server
  // access, rather than claiming that a paywall can retract old browser data.
  const token = await page.evaluate(() => auth.currentUser.getIdToken());
  const freshRead = await fetch('http://127.0.0.1:8080/v1/projects/' + projectId + '/databases/(default)/documents/boekingen/alice',
    {headers: {Authorization: 'Bearer ' + token}});
  expect(freshRead.status).toBe(403);
  const writeCode = await page.evaluate(() => db.doc('boekingen/alice').update({prijs: 99}).then(() => 'toegestaan', error => error.code));
  expect(writeCode).toBe('permission-denied');
  expect((await database.doc('boekingen/alice').get()).exists).toBe(true);
  await database.doc('billingAccess/alice-uid').set({status: 'lifetime'});
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeHidden();
  expect(await page.evaluate(() => boekingen[0].naam)).toBe('Eigen boeking');
  await expect(page.locator('#abonnement-achtergrond')).toBeHidden();
  await expect(page.locator('#abonnement-achtergrond-afbeelding')).not.toHaveAttribute('src');
});

test('een tijdelijke storing in de toegangscontrole houdt de app dicht en kan zonder nieuwe login hersteld worden', async ({ page }) => {
  await seedUser();
  await enableTrial(Date.now());
  await page.route('**/api/subscription-status', async route => {
    if (!await page.evaluate(() => window.testRetryRequested === true)) return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Tijdelijk niet beschikbaar.'})});
    return route.fallback();
  });
  await page.goto('/');
  await login(page);
  await expect(page.locator('#abonnement-error')).toContainText('tijdelijk');
  await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => auth.currentUser.uid)).toBe('alice-uid');
  await page.evaluate(() => document.getElementById('abonnement-opnieuw').addEventListener('click', () => { window.testRetryRequested = true; }, {capture: true}));
  await page.locator('#abonnement-opnieuw').click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#abonnement-overlay')).toBeHidden();
});

test('een vervalste betaal-terugkeerlink geeft geen toegang en betaalverzoeken bevatten alleen de gekozen optie', async ({ page }) => {
  await seedUser();
  await enableTrial(Date.now() - 8 * 86400000);
  let requested;
  await page.route('**/api/create-checkout-session', async route => {
    requested = route.request().postDataJSON();
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({url: 'https://onbekend.example/pay'})});
  });
  await page.goto('/?betaling=geslaagd');
  await login(page);
  await expect(page.locator('#abonnement-overlay')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await page.locator('[data-plan="jaar"]').click();
  await expect(page.locator('#abonnement-error')).toContainText('veilig');
  expect(requested).toEqual({plan: 'jaar'});
  expect((await database.doc('billingAccess/alice-uid').get()).data().status).toBe('trial');
});

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

test('het eerste scherm blijft neutraal totdat Firebase weet of er een sessie is', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/firebase-auth-compat.js', async route => {
    await gate; return route.fallback();
  });
  try {
    await page.goto('/', {waitUntil: 'commit'});
    await expect(page.locator('#sessie-laden')).toBeVisible();
    await expect(page.locator('#auth-overlay')).toBeHidden();
    await expect(page.locator('#app')).toBeHidden();
    await page.screenshot({path: test.info().outputPath('sessie-herstellen.png')});
    release();
    await expect(page.locator('#auth-overlay')).toBeVisible();
    await expect(page.locator('#sessie-laden')).toBeHidden();
  } finally { release(); }
});

test('herladen herstelt de sessie zonder het inlogformulier te laten zien', async ({page}) => {
  await seedUser(); await enableTrial();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-volg-sessie') !== 'ja') return;
    window.testLoginFlits = false;
    new MutationObserver(() => {
      const login = document.getElementById('auth-overlay');
      if (login && login.getBoundingClientRect().width > 0) window.testLoginFlits = true;
    }).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden']});
  });
  await page.goto('/'); await login(page);
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('test-volg-sessie', 'ja'));
  let reloaded = false, delayed = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloaded = true; });
  await page.route('**/api/subscription-status', async route => {
    if (reloaded && !delayed) { delayed = true; await gate; }
    return route.fallback();
  });
  try {
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.locator('#sessie-laden')).toBeVisible();
    await expect(page.locator('#auth-overlay')).toBeHidden();
    await expect(page.locator('#app')).toBeHidden();
    release();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#sessie-laden')).toBeHidden();
    expect(await page.evaluate(() => window.testLoginFlits)).toBe(false);
    expect(await page.evaluate(() => auth.currentUser.uid)).toBe('alice-uid');
  } finally { release(); }
});

for (const prepaid of [false, true]) {
test((prepaid ? 'een vooruitbetaalde proefweek' : 'een geldige sessie') + ' opent tijdens een trage betaalcontrole en sluit zodra die toegang intrekt', async ({page}) => {
  await seedUser(); await enableTrial();
  await database.doc('billingAccess/alice-uid').set({status: 'active', validUntil: Timestamp.fromMillis(Date.now() + 86400000),
    ...(prepaid ? {paidStartsAt: Timestamp.fromMillis(Date.now() + 12 * 3600000)} : {})});
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/subscription-status', async route => {
    if (route.request().postDataJSON()?.refresh === true && !started) {
      started = true;
      await gate;
      await database.doc('billingAccess/alice-uid').set({status: 'expired'});
    }
    return route.fallback();
  });
  try {
    await page.goto('/'); await login(page);
    await expect(page.locator('#app')).toBeVisible();
    await expect.poll(() => started).toBe(true);
    await expect(page.locator('#sessie-laden')).toBeHidden();
    await expect(page.locator('#auth-overlay')).toBeHidden();
    expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
    release();
    await expect(page.locator('#abonnement-overlay')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(() => boekingen)).toEqual([]);
    expect(await page.evaluate(() => auth.currentUser.uid)).toBe('alice-uid');
  } finally { release(); }
});
}

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

test('registratie accepteert zes tekens, weigert vijf en vereist uitnodiging en e-mailverificatie', async ({ page }) => {
  await database.doc('codes/UITNODIGING-123').set({ code: 'UITNODIGING-123', gebruikt: false, gebruiker: null });
  await page.goto('/');
  await page.locator('#auth-wissel').click();
  await page.locator('#auth-user').fill('nieuw');
  await page.locator('#auth-email').fill('nieuw@example.test');
  await page.locator('#auth-pass').fill('Kort5');
  await page.locator('#auth-pass2').fill('Kort5');
  await page.locator('#auth-code').fill('UITNODIGING-123');
  await page.locator('#auth-btn').click();
  await expect(page.locator('#auth-error')).toContainText('minimaal 6 tekens');
  expect((await authentication.listUsers()).users).toHaveLength(0);
  await page.locator('#auth-pass').fill('Kort6!');
  await page.locator('#auth-pass2').fill('Kort6!');
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
  await login(page, user.email, 'Kort6!');
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
