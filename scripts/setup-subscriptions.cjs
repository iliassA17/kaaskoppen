const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {PLANS} = require('../subscription-access.js');
const {validPrice} = require('../netlify/lib/billing.cjs');
const AMOUNTS = Object.freeze({maand: 799, halfjaar: 3999, jaar: 5999, levenslang: 9999});

async function setupSubscriptions({database, stripe, projectId, liveMode = false, apply = false, enable = false}) {
  const configRef = database.doc('billing/config'), markerRef = database.doc('billing/setup');
  const [configSnapshot, markerSnapshot] = await Promise.all([configRef.get(), markerRef.get()]);
  const current = configSnapshot.data(), marker = markerSnapshot.data();
  let existingUids = marker?.existingUids;
  if (!marker) {
    const accounts = await database.collection('accounts').get();
    if (accounts.size !== 5) throw new Error('De eerste inrichting verwacht de vijf bestaande accounts. Controleer dit eerst; er is niets aan de database gewijzigd.');
    existingUids = [];
    for (const account of accounts.docs) {
      const uid = account.data().uid;
      if (!uid || (await database.doc('authUsers/' + uid).get()).data()?.gebruiker !== account.id || existingUids.includes(uid)) {
        throw new Error('Een bestaand account heeft geen geldige unieke UID-koppeling. Er is niets gewijzigd.');
      }
      existingUids.push(uid);
    }
  }
  if (!Array.isArray(existingUids) || existingUids.length !== 5) throw new Error('De lijst met bestaande vrijgestelde accounts is ongeldig.');
  if (current && (current.provider !== 'stripe' || current.taxIncluded !== true || current.stripeLiveMode !== liveMode)) {
    throw new Error('De bestaande betaalconfiguratie hoort bij andere instellingen. Er is niets gewijzigd.');
  }
  if (enable && !current) throw new Error('Voer eerst de inrichting uit zonder --enable. Publiceer daarna de Functions en test de Stripe-webhook.');
  if (enable) {
    for (const uid of existingUids) {
      if ((await database.doc('billingAccess/' + uid).get()).data()?.status !== 'free') {
        throw new Error('Een van de vijf bestaande accounts heeft nog geen gratis blijvende toegang. Er is niets gewijzigd.');
      }
    }
  }
  const result = {existingAccounts: existingUids.length, pricesEUR: {maand: '7,99', halfjaar: '39,99', jaar: '59,99', levenslang: '99,99'},
    taxIncluded: true, stripeMode: liveMode ? 'live' : 'test', enabled: enable || current?.enabled === true, applied: apply};
  if (!apply) return result;
  if (!stripe) throw new Error('Stel eerst de Stripe secret key privé in.');
  const metadata = {app: 'boekingsschema', projectId};
  let productId = current?.stripeProductId;
  if (!productId) productId = (await stripe.products.create({name: 'Boekingsschema', metadata},
    {idempotencyKey: 'boekingsschema-product-' + projectId})).id;
  const plans = {};
  for (const [plan, amountCents] of Object.entries(AMOUNTS)) {
    let price;
    if (current?.plans?.[plan]?.stripePriceId) price = await stripe.prices.retrieve(current.plans[plan].stripePriceId);
    else {
      const params = {product: productId, currency: 'eur', unit_amount: amountCents, tax_behavior: 'inclusive', metadata: {...metadata, plan}};
      if (PLANS[plan].months !== null) params.recurring = {interval: 'month', interval_count: PLANS[plan].months};
      price = await stripe.prices.create(params, {idempotencyKey: 'boekingsschema-price-' + projectId + '-' + plan + '-' + amountCents});
    }
    if (!price.active || !validPrice(price, plan, projectId) || price.unit_amount !== amountCents) {
      throw new Error('Een Stripe-prijs wijkt af van de afgesproken prijs of looptijd. De database is niet gewijzigd.');
    }
    plans[plan] = {amountCents, stripePriceId: price.id};
  }
  await database.runTransaction(async tx => {
    const [latestConfig, latestMarker] = await Promise.all([tx.get(configRef), tx.get(markerRef)]);
    if (latestConfig.exists !== configSnapshot.exists || latestMarker.exists !== markerSnapshot.exists ||
        (latestConfig.exists && !latestConfig.updateTime.isEqual(configSnapshot.updateTime)) ||
        (latestMarker.exists && !latestMarker.updateTime.isEqual(markerSnapshot.updateTime))) {
      throw new Error('De betaalinstellingen zijn ondertussen gewijzigd. Voer de controle opnieuw uit.');
    }
    if (!marker) {
      tx.create(markerRef, {existingUids, createdAt: FieldValue.serverTimestamp()});
      for (const uid of existingUids) tx.set(database.doc('billingAccess/' + uid), {status: 'free', source: 'existing-account'});
    }
    tx.set(configRef, {enabled: result.enabled, provider: 'stripe', taxIncluded: true, stripeLiveMode: liveMode,
      stripeProductId: productId, plans});
  });
  return result;
}

async function main() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Certificaatcontrole is uitgeschakeld. Verwijder NODE_TLS_REJECT_UNAUTHORIZED=0 voordat je verdergaat.');
  const args = process.argv.slice(2), index = args.indexOf('--project');
  const projectId = index >= 0 && args[index + 1];
  if (!projectId || projectId.startsWith('--')) throw new Error('Gebruik --project PROJECT_ID [--apply] [--enable].');
  require('../netlify/lib/project.cjs').assertSandboxProject(projectId);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') { i++; continue; }
    if (!['--apply', '--enable'].includes(args[i])) throw new Error('Onbekend argument: ' + args[i]);
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && !/^sk_(test|live)_/.test(key)) throw new Error('De Stripe secret key heeft geen geldig formaat.');
  if (args.includes('--apply') && !key) throw new Error('De Stripe secret key ontbreekt. Er is niets gewijzigd.');
  const app = initializeApp({projectId, credential: applicationDefault()});
  const stripe = key ? new (require('stripe'))(key, {timeout: 15000, maxNetworkRetries: 1}) : null;
  console.log(JSON.stringify(await setupSubscriptions({database: getFirestore(app), stripe, projectId,
    liveMode: key?.startsWith('sk_live_') === true, apply: args.includes('--apply'), enable: args.includes('--enable')})));
}
if (require.main === module) main().catch(error => {
  // Stripe errors may include request details; keep secret-bearing errors out of
  // screenshots and copied terminal output.
  console.error(error.type?.startsWith('Stripe') ? 'Stripe kon de inrichting niet uitvoeren. Controleer je sleutel en verbinding privé in Stripe.' : error.message);
  process.exitCode = 1;
});
module.exports = {setupSubscriptions, AMOUNTS};
