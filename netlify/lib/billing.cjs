const {randomUUID} = require('node:crypto');
const {initializeApp, getApps, cert} = require('firebase-admin/app');
const {getFirestore, Timestamp, FieldValue} = require('firebase-admin/firestore');
const Stripe = require('stripe');
const {PLANS} = require('../../subscription-access.js');

class BillingError extends Error {
  constructor(message, statusCode = 503) { super(message); this.statusCode = statusCode; }
}
const id = value => typeof value === 'string' ? value : value?.id;
const metadataFor = (uid, projectId) => ({uid, projectId, app: 'boekingsschema'});
const matches = (metadata, uid, projectId) => metadata?.uid === uid &&
  metadata.projectId === projectId && metadata.app === 'boekingsschema';

function dependencies() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new BillingError('Veilige betaalverbinding is niet ingesteld.');
  const key = process.env.STRIPE_SECRET_KEY;
  const projectId = require('./project.cjs').projectId();
  if (key?.startsWith('sk_live_')) throw new BillingError('Gebruik uitsluitend een Stripe-testsleutel op deze testversie.');
  if (!/^sk_test_/.test(key || '') || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new BillingError('Betalen is nog niet ingesteld. Neem contact op met de beheerder.');
  }
  if (key.startsWith('sk_live_') && (process.env.BILLING_LIVE_ENABLED !== 'true' ||
      (process.env.CONTEXT && process.env.CONTEXT !== 'production'))) {
    throw new BillingError('Live betalingen zijn uitsluitend op de productieomgeving beschikbaar.');
  }
  let appUrl, account;
  try {
    appUrl = new URL(process.env.APP_URL);
    account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch { throw new BillingError('De betaalomgeving is niet volledig ingesteld.'); }
  if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password || account.project_id !== projectId) {
    throw new BillingError('De betaalomgeving is niet volledig ingesteld.');
  }
  const name = 'billing-admin';
  const app = getApps().find(app => app.name === name) || initializeApp({projectId, credential: cert(account)}, name);
  return {database: getFirestore(app), stripe: new Stripe(key, {timeout: 15000, maxNetworkRetries: 1}),
    projectId, appUrl: appUrl.origin, liveMode: key.startsWith('sk_live_')};
}

async function configuration(deps, requireEnabled = true) {
  const config = (await deps.database.doc('billing/config').get()).data();
  if (!config || (requireEnabled && config.enabled !== true) || config.provider !== 'stripe' || config.taxIncluded !== true ||
      config.stripeLiveMode !== deps.liveMode) throw new BillingError('Betalen is nog niet beschikbaar. Neem contact op met de beheerder.');
  return config;
}

function validPrice(price, plan, projectId) {
  const months = PLANS[plan]?.months;
  return price && price.currency === 'eur' && Number.isSafeInteger(price.unit_amount) && price.unit_amount > 0 &&
    price.tax_behavior === 'inclusive' && price.metadata?.projectId === projectId &&
    price.metadata.app === 'boekingsschema' && price.metadata.plan === plan &&
    (months === null ? price.type === 'one_time' && !price.recurring :
      (price.type === 'recurring' && price.recurring?.interval === 'month' && price.recurring.interval_count === months));
}

async function customerFor(identity, deps) {
  const uid = identity.user.uid;
  const mapping = (await deps.database.doc('authUsers/' + uid).get()).data();
  if (!mapping?.gebruiker || (await deps.database.collection('accounts').doc(mapping.gebruiker).get()).data()?.uid !== uid) {
    throw new BillingError('Je account is nog niet gereed voor betalen.', 403);
  }
  const ref = deps.database.doc('billingCustomers/' + uid);
  const existing = (await ref.get()).data();
  if (existing?.customerId) {
    const customer = await deps.stripe.customers.retrieve(existing.customerId);
    if (customer.deleted || !matches(customer.metadata, uid, deps.projectId)) throw new BillingError('Je betaalaccount kan niet worden gecontroleerd.');
    return customer.id;
  }
  const customer = await deps.stripe.customers.create({email: identity.user.email,
    metadata: metadataFor(uid, deps.projectId)}, {idempotencyKey: 'customer-' + deps.projectId + '-' + uid});
  await ref.set({customerId: customer.id, createdAt: FieldValue.serverTimestamp()});
  return customer.id;
}

async function lock(deps, name) {
  const ref = deps.database.doc('billingLocks/' + name), token = randomUUID();
  await deps.database.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.until?.toMillis() > Date.now()) throw new BillingError('Er wordt al een betaling verwerkt. Probeer het over een ogenblik opnieuw.', 409);
    tx.set(ref, {token, until: Timestamp.fromMillis(Date.now() + 180000)});
  });
  return {ref, token};
}
async function unlock(deps, lease) {
  await deps.database.runTransaction(async tx => {
    if ((await tx.get(lease.ref)).data()?.token === lease.token) tx.delete(lease.ref);
  });
}

async function createCheckout(identity, plan, deps = dependencies()) {
  if (!Object.hasOwn(PLANS, plan)) throw new BillingError('Kies een geldige betaaloptie.', 400);
  const config = await configuration(deps);
  const lease = await lock(deps, identity.user.uid + '-checkout');
  try {
    const access = (await deps.database.doc('billingAccess/' + identity.user.uid).get()).data();
    if (identity.user.admin === true || ['free', 'lifetime'].includes(access?.status)) {
      throw new BillingError('Je hebt al blijvende toegang. Je hoeft niet te betalen.', 409);
    }
    const customer = await customerFor(identity, deps);
    if (await entitlement(identity.user.uid, customer, deps)) {
      throw new BillingError('Je hebt al betaalde toegang. Klik op Opnieuw controleren of op Abonnement beheren.', 409);
    }
    // Also check Stripe when a webhook has not yet reached the database.
    for await (const subscription of deps.stripe.subscriptions.list({customer, status: 'all', limit: 100})) {
      if (matches(subscription.metadata, identity.user.uid, deps.projectId) &&
          !['canceled', 'incomplete_expired'].includes(subscription.status)) {
        throw new BillingError('Je hebt al een abonnement of lopende betaling. Gebruik Abonnement beheren.', 409);
      }
    }
    const ref = deps.database.doc('billingCheckout/' + identity.user.uid);
    const previous = (await ref.get()).data();
    if (previous?.sessionId) {
      const session = await deps.stripe.checkout.sessions.retrieve(previous.sessionId);
      if (id(session.customer) !== customer) throw new BillingError('De vorige betaalpagina kan niet worden gecontroleerd.');
      if (session.status === 'open' && previous.plan === plan) return {url: session.url};
      if (session.status === 'open') await deps.stripe.checkout.sessions.expire(session.id);
      if (session.status === 'complete' && session.created * 1000 > Date.now() - 86400000) {
        // A settled payment for an ended subscription is no longer pending,
        // even when a Stripe test clock ended it within the same real day.
        let endedPaidSubscription = false;
        if (session.mode === 'subscription' && session.payment_status === 'paid' && id(session.subscription)) {
          const subscription = await deps.stripe.subscriptions.retrieve(id(session.subscription));
          if (id(subscription?.customer) !== customer || !matches(subscription?.metadata, identity.user.uid, deps.projectId)) {
            throw new BillingError('Het vorige abonnement kan niet worden gecontroleerd.');
          }
          endedPaidSubscription = ['canceled', 'incomplete_expired'].includes(subscription.status);
        }
        if (!endedPaidSubscription) {
          throw new BillingError('Je vorige betaling wordt nog verwerkt. Klik op Opnieuw controleren.', 409);
        }
      }
    }
    const chosen = config.plans?.[plan];
    if (!chosen?.stripePriceId) throw new BillingError('Deze betaaloptie is nog niet ingesteld.');
    const price = await deps.stripe.prices.retrieve(chosen.stripePriceId);
    if (!price.active || !validPrice(price, plan, deps.projectId) || price.unit_amount !== chosen.amountCents) {
      throw new BillingError('Deze betaaloptie kan niet veilig worden gecontroleerd. Neem contact op met de beheerder.');
    }
    const metadata = {...metadataFor(identity.user.uid, deps.projectId), plan};
    const mode = plan === 'levenslang' ? 'payment' : 'subscription';
    const params = {mode, customer, client_reference_id: identity.user.uid, metadata,
      line_items: [{price: price.id, quantity: 1}],
      success_url: deps.appUrl + '/?betaling=geslaagd', cancel_url: deps.appUrl + '/?betaling=geannuleerd'};
    if (mode === 'subscription') params.subscription_data = {metadata};
    else {
      params.payment_intent_data = {metadata};
      params.invoice_creation = {enabled: true};
    }
    const session = await deps.stripe.checkout.sessions.create(params, {idempotencyKey: 'checkout-' + lease.token});
    await ref.set({sessionId: session.id, plan, createdAt: FieldValue.serverTimestamp()});
    return {url: session.url};
  } finally { await unlock(deps, lease); }
}

async function createPortal(identity, deps = dependencies()) {
  await configuration(deps, false);
  const record = (await deps.database.doc('billingCustomers/' + identity.user.uid).get()).data();
  if (!record?.customerId) throw new BillingError('Je hebt nog geen betaalaccount. Kies eerst een betaaloptie.', 404);
  const customer = await deps.stripe.customers.retrieve(record.customerId);
  if (customer.deleted || !matches(customer.metadata, identity.user.uid, deps.projectId)) throw new BillingError('Je betaalaccount kan niet worden gecontroleerd.');
  const session = await deps.stripe.billingPortal.sessions.create({customer: customer.id, return_url: deps.appUrl});
  return {url: session.url};
}

async function paymentValid(paymentIntent, deps) {
  const intent = await deps.stripe.paymentIntents.retrieve(id(paymentIntent), {expand: ['latest_charge']});
  const charge = intent.latest_charge;
  if (intent.status !== 'succeeded' || !charge || typeof charge === 'string' || !charge.paid ||
      charge.refunded || charge.amount_refunded >= charge.amount) return false;
  if (charge.disputed) {
    // A won dispute can restore access; an unresolved/lost dispute cannot.
    const disputes = await deps.stripe.disputes.list({payment_intent: intent.id, limit: 100});
    if (!disputes.data.length || disputes.data.some(dispute => dispute.status !== 'won')) return false;
  }
  return true;
}

async function entitlement(uid, customer, deps) {
  let lifetime = false, validUntil = 0, count = 0;
  for await (const session of deps.stripe.checkout.sessions.list({customer, status: 'complete', limit: 100})) {
    if (++count > 1000) throw new BillingError('De betaalhistorie vereist controle door de beheerder.');
    if (session.mode === 'payment' && session.payment_status === 'paid' && session.currency === 'eur' &&
        session.metadata?.plan === 'levenslang' && matches(session.metadata, uid, deps.projectId) &&
        session.client_reference_id === uid && session.payment_intent && await paymentValid(session.payment_intent, deps)) {
      lifetime = true;
    }
  }
  if (lifetime) return {status: 'lifetime'};
  count = 0;
  for await (const subscription of deps.stripe.subscriptions.list({customer, status: 'all', limit: 100})) {
    if (++count > 100) throw new BillingError('De abonnementshistorie vereist controle door de beheerder.');
    if (!matches(subscription.metadata, uid, deps.projectId) || !['active', 'past_due'].includes(subscription.status)) continue;
    const plan = subscription.metadata.plan, item = subscription.items?.data?.[0];
    if (plan === 'levenslang' || subscription.items.data.length !== 1 || item.quantity !== 1 || !validPrice(item.price, plan, deps.projectId)) continue;
    const invoices = await deps.stripe.invoices.list({subscription: subscription.id, status: 'paid', limit: 1});
    const invoice = invoices.data[0];
    if (!invoice || id(invoice.customer) !== customer) continue;
    const payments = await deps.stripe.invoicePayments.list({invoice: invoice.id, status: 'paid', limit: 100});
    if (payments.has_more) throw new BillingError('De factuur vereist controle door de beheerder.');
    let paid = true;
    for (const payment of payments.data) {
      if (payment.payment?.type === 'payment_intent' && !await paymentValid(payment.payment.payment_intent, deps)) paid = false;
    }
    if (!paid) continue;
    // The paid invoice determines coverage, not the next (possibly unpaid)
    // subscription period. This prevents extending access on failed renewals.
    for await (const line of deps.stripe.invoices.listLineItems(invoice.id, {limit: 100})) {
      if (line.parent?.subscription_item_details?.subscription_item === item.id &&
          !line.parent.subscription_item_details.proration && line.period?.end > 0) {
        validUntil = Math.max(validUntil, Math.min(line.period.end, item.current_period_end) * 1000);
      }
    }
  }
  return validUntil > Date.now() ? {status: 'active', validUntil: Timestamp.fromMillis(validUntil)} : null;
}

const WEBHOOK_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']);

async function processEvent(event, deps = dependencies()) {
  if (!WEBHOOK_EVENTS.has(event.type)) return {ignored: true};
  if (event.livemode !== deps.liveMode) throw new BillingError('Onjuiste betaalomgeving.', 400);
  await configuration(deps, false);
  const object = event.data.object;
  let customerId = id(object.customer);
  if (!customerId && object.charge) customerId = id((await deps.stripe.charges.retrieve(id(object.charge))).customer);
  if (!customerId) return {ignored: true};
  const customer = await deps.stripe.customers.retrieve(customerId);
  const uid = customer.metadata?.uid;
  if (customer.deleted || !uid || !matches(customer.metadata, uid, deps.projectId)) return {ignored: true};
  const bound = (await deps.database.doc('billingCustomers/' + uid).get()).data();
  if (bound?.customerId !== customerId) return {ignored: true};
  const eventRef = deps.database.doc('billingEvents/' + event.id);
  if ((await eventRef.get()).exists) return {duplicate: true};
  const lease = await lock(deps, uid + '-sync');
  try {
    const access = await entitlement(uid, customerId, deps);
    await deps.database.runTransaction(async tx => {
      const ref = deps.database.doc('billingAccess/' + uid);
      const [current, processed, locked] = await Promise.all([tx.get(ref), tx.get(eventRef), tx.get(lease.ref)]);
      if (locked.data()?.token !== lease.token) throw new BillingError('De betaalcontrole wordt opnieuw uitgevoerd.');
      if (processed.exists) return;
      // Preserve the owner's permanent exemptions and an unfinished trial.
      const existing = current.data();
      if (!['free', 'blocked'].includes(existing?.status) && (access || ['active', 'lifetime'].includes(existing?.status))) {
        tx.set(ref, {...(access || {status: 'expired'}), source: 'stripe', stripeCustomerId: customerId,
          checkedAt: FieldValue.serverTimestamp()});
      }
      tx.set(eventRef, {type: event.type, customerId, processedAt: FieldValue.serverTimestamp()});
    });
    return {received: true};
  } finally { await unlock(deps, lease); }
}

async function refreshAccess(uid, deps = dependencies()) {
  const customer = (await deps.database.doc('billingCustomers/' + uid).get()).data();
  if (!customer?.customerId) return;
  // Recovery if a webhook was delayed. All rights are still read from Stripe;
  // a success URL or a browser-supplied payment/session ID grants nothing.
  return processEvent({id: 'refresh-' + uid + '-' + Math.floor(Date.now() / 15000),
    type: 'checkout.session.completed', livemode: deps.liveMode,
    data: {object: {customer: customer.customerId}}}, deps);
}

module.exports = {BillingError, dependencies, configuration, validPrice, createCheckout, createPortal,
  entitlement, processEvent, refreshAccess, WEBHOOK_EVENTS, metadataFor, matches};
