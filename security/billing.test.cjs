const {before, beforeEach, test} = require('node:test');
const assert = require('node:assert/strict');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const Stripe = require('stripe');
const {createCheckout, createPortal, processEvent, metadataFor} = require('../netlify/lib/billing.cjs');
const {setupSubscriptions, AMOUNTS} = require('../scripts/setup-subscriptions.cjs');
const {PLANS} = require('../subscription-access.js');
const projectId = 'demo-kaaskoppen', uid = 'alice-uid';
const identity = {user: {uid, email: 'alice@example.test'}};
const meta = plan => ({...metadataFor(uid, projectId), plan});
const list = data => ({data, has_more: false, async *[Symbol.asyncIterator]() { yield* data; }});
let database, deps, state;

before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  database = getFirestore(initializeApp({projectId}, 'billing-tests'));
});
beforeEach(async () => {
  assert.equal((await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method: 'DELETE'})).ok, true);
  for (const name of ['alice', 'bob', 'carol', 'dave', 'eve']) {
    await database.doc('accounts/' + name).set({uid: name + '-uid', gebruiker: name, email: name + '@example.test'});
    await database.doc('authUsers/' + name + '-uid').set({gebruiker: name});
  }
  await database.doc('boekingen/alice').set({gebruiker: 'alice', prijs: 0});
  const prices = Object.fromEntries(Object.entries(AMOUNTS).map(([plan, amount]) => [plan, {
    id: 'price_' + plan, active: true, currency: 'eur', unit_amount: amount, tax_behavior: 'inclusive',
    type: plan === 'levenslang' ? 'one_time' : 'recurring', metadata: {...meta(plan), uid: undefined},
    ...(plan === 'levenslang' ? {} : {recurring: {interval: 'month', interval_count: PLANS[plan].months}})
  }]));
  state = {prices, sessions: [], subscriptions: [], invoices: [], lines: [], invoicePayments: [],
    calls: [], paymentValid: true, customer: {id: 'cus_alice', metadata: metadataFor(uid, projectId)}};
  const stripe = {
    products: {create: async params => { state.calls.push(['product', params]); return {id: 'prod_bookings'}; }},
    prices: {
      retrieve: async priceId => Object.values(state.prices).find(price => price.id === priceId),
      create: async params => { state.calls.push(['price', params]); return state.prices[params.metadata.plan]; }
    },
    customers: {retrieve: async () => state.customer, create: async params => {
      state.calls.push(['customer', params]); return state.customer;
    }},
    subscriptions: {list: () => list(state.subscriptions)},
    checkout: {sessions: {
      list: () => list(state.sessions.filter(session => session.status === 'complete')),
      retrieve: async sessionId => state.sessions.find(session => session.id === sessionId),
      expire: async sessionId => { state.sessions.find(session => session.id === sessionId).status = 'expired'; },
      create: async params => {
        state.calls.push(['checkout', params]);
        const session = {id: 'cs_' + state.calls.length, status: 'open', url: 'https://checkout.stripe.com/c/pay/test',
          created: Math.floor(Date.now() / 1000), ...params};
        state.sessions.push(session); return session;
      }
    }},
    billingPortal: {sessions: {create: async params => {
      state.calls.push(['portal', params]); return {url: 'https://billing.stripe.com/p/session/test'};
    }}},
    invoices: {list: async () => list(state.invoices.filter(invoice => invoice.status === 'paid')),
      listLineItems: () => list(state.lines)},
    invoicePayments: {list: async () => list(state.invoicePayments)},
    paymentIntents: {retrieve: async paymentId => {
      state.calls.push(['payment', paymentId]);
      return {id: paymentId, status: state.paymentValid ? 'succeeded' : 'processing',
        latest_charge: {paid: true, refunded: !!state.refunded, disputed: !!state.disputed, amount: 9999, amount_refunded: state.refunded ? 9999 : 0}};
    }},
    disputes: {list: async () => list([{status: state.disputeStatus || 'needs_response'}])}
  };
  deps = {database, stripe, projectId, liveMode: false, appUrl: 'https://app.example.test'};
  await database.doc('billing/config').set({enabled: true, provider: 'stripe', taxIncluded: true, stripeLiveMode: false,
    plans: Object.fromEntries(Object.entries(prices).map(([plan, price]) => [plan, {amountCents: price.unit_amount, stripePriceId: price.id}]))});
});

const event = (eventId = 'evt_1', type = 'checkout.session.completed') => ({id: eventId, type, livemode: false,
  data: {object: {customer: 'cus_alice'}}});
async function boundCustomer() { await database.doc('billingCustomers/' + uid).set({customerId: 'cus_alice'}); }
function lifetimePayment(paid = true) {
  state.sessions.push({id: 'cs_lifetime', status: 'complete', mode: 'payment', currency: 'eur', metadata: meta('levenslang'),
    client_reference_id: uid, payment_intent: 'pi_lifetime', customer: 'cus_alice', payment_status: paid ? 'paid' : 'unpaid'});
}
function subscriptionPayment() {
  const end = Math.floor(Date.now() / 1000) + 86400;
  state.subscriptions.push({id: 'sub_month', status: 'active', customer: 'cus_alice', metadata: meta('maand'),
    items: {data: [{id: 'si_month', quantity: 1, price: state.prices.maand, current_period_end: end}]}});
  state.invoices.push({id: 'in_paid', customer: 'cus_alice', status: 'paid'});
  state.lines.push({parent: {subscription_item_details: {subscription_item: 'si_month', proration: false}}, period: {end}});
  state.invoicePayments.push({payment: {type: 'payment_intent', payment_intent: 'pi_month'}});
  return end;
}

test('de vier betaalopties gebruiken uitsluitend serverprijzen, vaste looptijden en de eigen UID', async () => {
  for (const plan of Object.keys(AMOUNTS)) {
    await database.doc('billingCheckout/' + uid).delete();
    const result = await createCheckout(identity, plan, deps);
    assert.match(result.url, /^https:\/\/checkout\.stripe\.com\//);
    const params = state.calls.filter(call => call[0] === 'checkout').at(-1)[1];
    assert.deepEqual(params.line_items, [{price: 'price_' + plan, quantity: 1}]);
    assert.equal(params.mode, plan === 'levenslang' ? 'payment' : 'subscription');
    assert.equal(params.client_reference_id, uid);
    assert.equal(params.success_url, 'https://app.example.test/?betaling=geslaagd');
    assert.equal((params.subscription_data || params.payment_intent_data).metadata.plan, plan);
  }
  await assert.rejects(createCheckout(identity, 'onbekend', deps), error => error.statusCode === 400);
});

test('afwijkende Stripe-prijzen en dubbele betalingen worden tegengehouden', async () => {
  state.prices.maand.unit_amount = 1;
  await assert.rejects(createCheckout(identity, 'maand', deps), /veilig/);
  assert.equal(state.calls.filter(call => call[0] === 'checkout').length, 0);
  state.prices.maand.unit_amount = 799;
  const results = await Promise.allSettled([createCheckout(identity, 'maand', deps), createCheckout(identity, 'maand', deps)]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.statusCode, 409);
  assert.equal(state.calls.filter(call => call[0] === 'checkout').length, 1);
  await createCheckout(identity, 'maand', deps);
  assert.equal(state.calls.filter(call => call[0] === 'checkout').length, 1);
  const old = state.sessions[0];
  await createCheckout(identity, 'jaar', deps);
  assert.equal(old.status, 'expired');
  assert.equal(state.calls.filter(call => call[0] === 'checkout').length, 2);
});

test('vrijgestelde accounts betalen niet en bestaande Stripe-abonnementen krijgen geen tweede abonnement', async () => {
  await database.doc('billingAccess/' + uid).set({status: 'free'});
  await assert.rejects(createCheckout(identity, 'maand', deps), /niet te betalen/);
  await database.doc('billingAccess/' + uid).delete();
  subscriptionPayment();
  await assert.rejects(createCheckout(identity, 'maand', deps), /al betaalde toegang/);
  state.invoices = [];
  await assert.rejects(createCheckout(identity, 'maand', deps), /al een abonnement/);
});

test('levenslange toegang volgt een betaalde Stripe-betaling; herhaalde en oude berichten verlengen niets', async () => {
  await boundCustomer(); lifetimePayment();
  await processEvent(event(), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'lifetime');
  assert.deepEqual(await processEvent(event(), deps), {duplicate: true});
  state.refunded = true;
  await processEvent(event('evt_refund', 'charge.refunded'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  await processEvent({...event('evt_old'), created: 1}, deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  assert.equal((await database.doc('boekingen/alice').get()).data().prijs, 0);
});

test('onbetaalde of nog verwerkte betalingen geven geen toegang; succes kan later alsnog binnenkomen', async () => {
  await boundCustomer(); lifetimePayment(false);
  await processEvent(event(), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).exists, false);
  state.sessions[0].payment_status = 'paid'; state.paymentValid = false;
  await processEvent(event('evt_processing'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).exists, false);
  state.paymentValid = true;
  await processEvent(event('evt_success', 'checkout.session.async_payment_succeeded'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'lifetime');
});

test('een maandbetaling dekt alleen de werkelijk betaalde periode, ook bij mislukte verlenging of opzegging', async () => {
  await boundCustomer(); const end = subscriptionPayment();
  await processEvent(event('evt_paid', 'invoice.paid'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().validUntil.toMillis(), end * 1000);
  state.subscriptions[0].cancel_at_period_end = true;
  await processEvent(event('evt_cancel_later', 'customer.subscription.updated'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'active');
  state.subscriptions[0].status = 'past_due';
  state.subscriptions[0].items.data[0].current_period_end += 86400 * 30;
  state.lines[0].period.end = Math.floor(Date.now() / 1000) - 10;
  state.invoices.unshift({id: 'in_unpaid', customer: 'cus_alice', status: 'open'});
  await processEvent(event('evt_failed', 'invoice.payment_failed'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  state.subscriptions[0].status = 'canceled';
  state.lines[0].period.end = end;
  await processEvent(event('evt_canceled', 'customer.subscription.deleted'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
});

test('gratis toegang blijft bestaan en betaalberichten van een ander account worden genegeerd', async () => {
  await boundCustomer(); lifetimePayment();
  await database.doc('billingAccess/' + uid).set({status: 'free'});
  await processEvent(event(), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'free');
  await database.doc('billingCustomers/' + uid).set({customerId: 'cus_other'});
  assert.deepEqual(await processEvent(event('evt_foreign'), deps), {ignored: true});
  await assert.rejects(processEvent({...event('evt_live'), livemode: true}, deps), /Onjuiste/);
});

test('betwiste betalingen en providerstoringen kunnen geen toegang geven of bestaande rechten wissen', async () => {
  await boundCustomer(); lifetimePayment();
  await processEvent(event(), deps);
  const existing = (await database.doc('billingAccess/' + uid).get()).data();
  const original = deps.stripe.paymentIntents.retrieve;
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('Provider tijdelijk onbereikbaar'); };
  await assert.rejects(processEvent(event('evt_outage'), deps), /tijdelijk/);
  assert.deepEqual((await database.doc('billingAccess/' + uid).get()).data(), existing);
  assert.equal((await database.doc('billingEvents/evt_outage').get()).exists, false);
  deps.stripe.paymentIntents.retrieve = original;
  state.disputed = true;
  await processEvent(event('evt_dispute', 'charge.dispute.created'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  state.disputeStatus = 'won';
  await processEvent(event('evt_dispute_won', 'charge.dispute.closed'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'lifetime');
});

test('facturen en opzeggen openen uitsluitend het Stripe-portaal van de geverifieerde gebruiker', async () => {
  await assert.rejects(createPortal(identity, deps), /nog geen betaalaccount/);
  await boundCustomer();
  assert.match((await createPortal(identity, deps)).url, /^https:\/\/billing\.stripe\.com\//);
  assert.deepEqual(state.calls.at(-1), ['portal', {customer: 'cus_alice', return_url: 'https://app.example.test'}]);
  state.customer.metadata.uid = 'bob-uid';
  await assert.rejects(createPortal(identity, deps), /niet worden gecontroleerd/);
});

test('de webhook controleert de Stripe-handtekening op de ongewijzigde body, ook met base64', async () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_fixture';
  try {
    let calls = 0;
    const handler = require('../netlify/functions/stripe-webhook.js').createHandler(async verified => {
      calls++; assert.equal(verified.id, 'evt_signed'); return {received: true};
    });
    const payload = JSON.stringify(event('evt_signed'));
    const signature = new Stripe('sk_test_local').webhooks.generateTestHeaderString({payload, secret: process.env.STRIPE_WEBHOOK_SECRET});
    const request = {httpMethod: 'POST', headers: {'stripe-signature': signature}, body: payload};
    assert.equal((await handler(request)).statusCode, 200);
    assert.equal((await handler({...request, body: Buffer.from(payload).toString('base64'), isBase64Encoded: true})).statusCode, 200);
    assert.equal((await handler({...request, body: payload + ' '})).statusCode, 400);
    assert.equal((await handler({...request, headers: {}})).statusCode, 400);
    assert.equal(calls, 2);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous;
  }
});

test('de inrichting is standaard alleen een controle; precies de oorspronkelijke vijf accounts krijgen eenmalig gratis toegang', async () => {
  await database.doc('billing/config').delete();
  const options = {database, stripe: deps.stripe, projectId};
  assert.equal((await setupSubscriptions(options)).applied, false);
  assert.equal((await database.collection('billingAccess').get()).size, 0);
  assert.equal(state.calls.length, 0);
  await setupSubscriptions({...options, apply: true});
  assert.equal((await database.collection('billingAccess').get()).size, 5);
  assert.equal((await database.doc('billing/config').get()).data().enabled, false);
  assert.equal((await database.doc('billing/config').get()).data().plans.levenslang.amountCents, 9999);
  await database.doc('accounts/newcomer').set({uid: 'newcomer-uid'});
  await database.doc('billingAccess/newcomer-uid').set({status: 'trial', trialStartedAt: Timestamp.now()});
  await setupSubscriptions({...options, apply: true});
  assert.equal((await database.doc('billingAccess/newcomer-uid').get()).data().status, 'trial');
  await setupSubscriptions({...options, apply: true, enable: true});
  assert.equal((await database.doc('billing/config').get()).data().enabled, true);
  await setupSubscriptions({...options, apply: true});
  assert.equal((await database.doc('billing/config').get()).data().enabled, true);
});

test('de eerste inrichting stopt bij meer dan vijf accounts of afwijkende prijzen', async () => {
  await database.doc('billing/config').delete();
  await database.doc('accounts/newcomer').set({uid: 'newcomer-uid'});
  await assert.rejects(setupSubscriptions({database, projectId, stripe: deps.stripe, apply: true}), /vijf bestaande/);
  await database.doc('accounts/newcomer').delete();
  state.prices.jaar.unit_amount = 1;
  await assert.rejects(setupSubscriptions({database, projectId, stripe: deps.stripe, apply: true}), /wijkt af/);
  assert.equal((await database.doc('billing/config').get()).exists, false);
  assert.equal((await database.collection('billingAccess').get()).size, 0);
});
