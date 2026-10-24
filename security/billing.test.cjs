const {before, beforeEach, test} = require('node:test');
const assert = require('node:assert/strict');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const Stripe = require('stripe');
const {createCheckout, createPortal, processEvent, metadataFor, afterMonths} = require('../netlify/lib/billing.cjs');
const {billingOverview} = require('../netlify/lib/billing-overview.cjs');
const {setupSubscriptions, AMOUNTS} = require('../scripts/setup-subscriptions.cjs');
const {PLANS} = require('../subscription-access.js');
const {accessState, TRIAL_MS} = require('../subscription-access.js');
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
    testHelpers: {testClocks: {retrieve: async clockId => {
      state.calls.push(['clock', clockId]);
      return state.clock;
    }}},
    subscriptions: {list: () => list(state.subscriptions), retrieve: async subscriptionId => {
      state.calls.push(['subscription', subscriptionId]);
      return state.subscriptions.find(subscription => subscription.id === subscriptionId);
    }},
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
    invoices: {list: async params => {
      state.calls.push(['invoices', params]);
      const invoices = state.invoices.filter(invoice => (!params.status || invoice.status === params.status) &&
        (!params.customer || invoice.customer === params.customer));
      const start = params.starting_after ? invoices.findIndex(invoice => invoice.id === params.starting_after) + 1 : 0;
      const limit = params.limit || invoices.length;
      return {...list(invoices.slice(start, start + limit)), has_more: start + limit < invoices.length};
    }, retrieve: async invoiceId => state.invoices.find(invoice => invoice.id === invoiceId),
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
    assert.equal(params.success_url, 'https://app.example.test/app/?betaling=geslaagd');
    assert.equal((params.subscription_data || params.payment_intent_data).metadata.plan, plan);
    if (plan === 'levenslang') assert.deepEqual(params.invoice_creation, {enabled: true});
  }
  await assert.rejects(createCheckout(identity, 'onbekend', deps), error => error.statusCode === 400);
});

test('proefgebruikers en vrijgestelde accounts zien hun status zonder een Stripe-klant aan te maken', async () => {
  const started = Timestamp.now();
  await database.doc('billingAccess/' + uid).set({status: 'trial', trialStartedAt: started});
  const trial = await billingOverview(identity, {}, deps);
  assert.equal(trial.access.kind, 'trial');
  assert.equal(trial.access.expiresAt, started.toMillis() + 7 * 86400000);
  assert.deepEqual(trial.invoices, []);
  assert.equal(trial.hasCustomer, false);
  assert.equal(state.calls.length, 0);
  await database.doc('billingAccess/' + uid).set({status: 'free'});
  assert.equal((await billingOverview(identity, {}, deps)).access.kind, 'free');
  assert.equal((await database.doc('billingCustomers/' + uid).get()).exists, false);
});

async function trialCheckout(plan = 'maand') {
  const started = Timestamp.fromMillis(Date.now() - 2 * 86400000);
  await database.doc('billingAccess/' + uid).set({status: 'trial', trialStartedAt: started});
  await createCheckout(identity, plan, deps);
  return {started, session: state.sessions.at(-1)};
}

function settlePrepayment(session) {
  session.status = 'complete'; session.payment_status = 'paid'; session.currency = 'eur';
  session.amount_total = state.prices[session.metadata.plan].unit_amount;
  session.subscription = 'sub_prepaid'; session.invoice = 'in_prepaid';
  state.subscriptions.push({id: session.subscription, customer: 'cus_alice', status: 'trialing',
    metadata: {...session.metadata}, items: {data: [{id: 'si_prepaid', quantity: 1,
      price: state.prices[session.metadata.plan], current_period_end: Number(session.metadata.prepaidEndsAt)}]}});
  state.invoices.push({id: session.invoice, customer: 'cus_alice', status: 'paid', currency: 'eur',
    total: session.amount_total, amount_paid: session.amount_total});
  state.invoicePayments.push({payment: {type: 'payment_intent', payment_intent: 'pi_prepaid'}});
}

test('vooruitbetalen rekent eenmaal de vaste prijs af en start verlengingen pas na de volledige betaalde periode', async () => {
  for (const plan of ['maand', 'halfjaar', 'jaar', 'levenslang']) {
    await database.doc('billingCheckout/' + uid).delete();
    state.sessions = [];
    const {started, session} = await trialCheckout(plan);
    assert.equal(Number(session.metadata.prepaidStartsAt), Math.ceil((started.toMillis() + TRIAL_MS) / 1000));
    assert.equal(session.line_items[0].price, 'price_' + plan);
    if (plan === 'levenslang') {
      assert.equal(session.line_items.length, 1);
      assert.equal(session.metadata.prepaidEndsAt, '');
    } else {
      assert.equal(session.line_items.length, 2);
      assert.equal(session.line_items[1].price_data.unit_amount, AMOUNTS[plan]);
      assert.equal(session.line_items[1].price_data.recurring, undefined);
      assert.equal(session.subscription_data.trial_end, Number(session.metadata.prepaidEndsAt));
      assert.ok(session.subscription_data.trial_end > Number(session.metadata.prepaidStartsAt) + 27 * 86400);
      assert.equal(session.subscription_data.metadata.prepaidStartsAt, session.metadata.prepaidStartsAt);
    }
    assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'trial');
  }
});

test('vooruitbetalen respecteert korte maanden en schrikkeldagen zonder de proefweek te verschuiven', () => {
  assert.equal(afterMonths(Date.UTC(2028, 0, 31, 12) / 1000, 1) * 1000, Date.UTC(2028, 1, 29, 12));
  assert.equal(afterMonths(Date.UTC(2028, 1, 29, 12) / 1000, 12) * 1000, Date.UTC(2029, 1, 28, 12));
});

test('betaalde vooruitbetaling behoudt proefdagen, blokkeert dubbel afrekenen en blijft geldig na opzeggen', async () => {
  const {started, session} = await trialCheckout('halfjaar');
  settlePrepayment(session);
  await processEvent(event('evt_prepaid'), deps);
  const access = (await database.doc('billingAccess/' + uid).get()).data();
  const config = (await database.doc('billing/config').get()).data();
  const start = Number(session.metadata.prepaidStartsAt) * 1000, end = Number(session.metadata.prepaidEndsAt) * 1000;
  assert.equal(access.trialStartedAt.toMillis(), started.toMillis());
  assert.deepEqual(accessState(config, access, start - 1, false), {allowed: true, kind: 'trial', expiresAt: start});
  assert.deepEqual(accessState(config, access, start, false), {allowed: true, kind: 'active', expiresAt: end});
  assert.equal(accessState(config, access, end, false).allowed, false);
  await assert.rejects(createCheckout(identity, 'jaar', deps), error => error.statusCode === 409);
  assert.deepEqual(await processEvent(event('evt_prepaid'), deps), {duplicate: true});
  state.subscriptions[0].status = 'canceled';
  await processEvent(event('evt_prepaid_cancel', 'customer.subscription.deleted'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().validUntil.toMillis(), end);
  const overview = await billingOverview(identity, {}, deps);
  assert.deepEqual(overview.prepaid, {startsAt: start, endsAt: end});
  assert.equal(overview.subscription.nextPaymentAt, null);
});

test('een onbetaalde, vreemde, onvolledige of teruggedraaide vooruitbetaling geeft geen betaalde periode', async () => {
  const {started, session} = await trialCheckout();
  settlePrepayment(session);
  const original = {status: 'trial', trialStartedAt: started};
  for (const [index, mutate] of [
    () => { session.payment_status = 'unpaid'; },
    () => { session.payment_status = 'paid'; state.paymentValid = false; },
    () => { state.paymentValid = true; state.refunded = true; },
    () => { state.refunded = false; state.subscriptions[0].metadata.uid = 'bob-uid'; },
    () => { state.subscriptions[0].metadata.uid = uid; session.amount_total = 1; },
    () => { session.amount_total = AMOUNTS.maand; state.invoicePayments = []; }
  ].entries()) {
    mutate();
    await processEvent(event('evt_bad_prepaid_' + index), deps);
    assert.deepEqual((await database.doc('billingAccess/' + uid).get()).data(), original);
  }
  state.invoicePayments.push({payment: {type: 'payment_intent', payment_intent: 'pi_prepaid'}});
  await processEvent(event('evt_good_prepaid'), deps);
  state.refunded = true;
  await processEvent(event('evt_refund_prepaid', 'charge.refunded'), deps);
  const restored = (await database.doc('billingAccess/' + uid).get()).data();
  assert.equal(restored.status, 'trial');
  assert.equal(restored.trialStartedAt.toMillis(), started.toMillis());
});

test('levenslang vooruitbetalen bewaart de proefweek en heeft geen automatische verlenging', async () => {
  const {session} = await trialCheckout('levenslang');
  Object.assign(session, {status: 'complete', payment_status: 'paid', currency: 'eur', payment_intent: 'pi_lifetime'});
  await processEvent(event('evt_prepaid_lifetime'), deps);
  const overview = await billingOverview(identity, {}, deps);
  assert.equal(overview.access.kind, 'trial');
  assert.equal(overview.subscription.plan, 'levenslang');
  assert.equal(overview.subscription.nextPaymentAt, null);
  assert.equal(overview.prepaid.endsAt, null);
  const access = (await database.doc('billingAccess/' + uid).get()).data();
  assert.equal(accessState({enabled: true}, access, Number(session.metadata.prepaidStartsAt) * 1000, false).kind, 'lifetime');
});

test('abonnementsoverzicht toont gekozen plan, volgende betaling en uitsluitend eigen betaalde en open facturen', async () => {
  await boundCustomer(); const end = subscriptionPayment();
  await database.doc('billingAccess/' + uid).set({status: 'active', validUntil: Timestamp.fromMillis(end * 1000)});
  state.invoices = [
    {id: 'in_open', customer: 'cus_alice', status: 'open', number: '2026-002', currency: 'eur', total: 799,
      amount_paid: 0, amount_remaining: 799, created: end - 100, due_date: end + 100,
      invoice_pdf: 'https://pay.stripe.com/invoice/test/pdf', hosted_invoice_url: 'https://invoice.stripe.com/i/test'},
    {id: 'in_paid', customer: 'cus_alice', status: 'paid', number: '2026-001', currency: 'eur', total: 799,
      amount_paid: 799, amount_remaining: 0, created: end - 500, status_transitions: {paid_at: end - 400}},
    {id: 'in_foreign', customer: 'cus_bob', status: 'paid', number: 'PRIVE-BOB'},
    {id: 'in_draft', customer: 'cus_alice', status: 'draft'},
  ];
  const result = await billingOverview(identity, {}, deps);
  assert.equal(result.subscription.plan, 'maand');
  assert.equal(result.subscription.amountCents, 799);
  assert.equal(result.subscription.nextPaymentAt, end * 1000);
  assert.deepEqual(result.invoices.map(invoice => invoice.id), ['in_open', 'in_paid']);
  assert.equal(result.invoices[0].remainingCents, 799);
  assert.equal(result.invoices[0].dueAt, (end + 100) * 1000);
  assert.equal(result.invoices[1].paidAt, (end - 400) * 1000);
  assert.equal(result.invoices[0].pdfUrl, 'https://pay.stripe.com/invoice/test/pdf');
  assert.equal(state.calls.find(call => call[0] === 'invoices')[1].customer, 'cus_alice');
  state.subscriptions[0].cancel_at_period_end = true;
  const cancelled = await billingOverview(identity, {}, deps);
  assert.equal(cancelled.subscription.cancelAtPeriodEnd, true);
  assert.equal(cancelled.subscription.nextPaymentAt, null);
});

test('ook verlopen toegang houdt eigen facturen bereikbaar; vreemde klanten, cursors en onveilige links worden geweigerd', async () => {
  await boundCustomer();
  await database.doc('billingAccess/' + uid).set({status: 'expired'});
  state.invoices = [{id: 'in_own', customer: 'cus_alice', status: 'paid', total: 9999,
    invoice_pdf: 'https://invoice.stripe.com.evil.test/invoice.pdf', hosted_invoice_url: 'javascript:alert(1)'},
  {id: 'in_foreign', customer: 'cus_bob', status: 'paid'}];
  const result = await billingOverview(identity, {}, deps);
  assert.equal(result.access.allowed, false);
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].pdfUrl, null);
  assert.equal(result.invoices[0].paymentUrl, null);
  await assert.rejects(billingOverview(identity, {after: 'in_foreign'}, deps), error => error.statusCode === 400);
  await assert.rejects(billingOverview(identity, {after: '../bob'}, deps), error => error.statusCode === 400);
  state.customer.metadata.uid = 'bob-uid';
  await assert.rejects(billingOverview(identity, {}, deps), /betaalaccount/);
});

test('factuurpaginering slaat geen facturen over en levenslange toegang krijgt geen volgende afschrijving', async () => {
  await boundCustomer();
  state.invoices = Array.from({length: 25}, (_, index) => ({id: 'in_' + index, customer: 'cus_alice', status: 'paid', total: 799}));
  await database.doc('billingAccess/' + uid).set({status: 'lifetime'});
  const first = await billingOverview(identity, {}, deps);
  assert.equal(first.subscription.plan, 'levenslang');
  assert.equal(first.subscription.nextPaymentAt, null);
  assert.equal(first.invoices.length, 20);
  assert.equal(first.nextCursor, 'in_19');
  const second = await billingOverview(identity, {after: first.nextCursor}, deps);
  assert.equal(second.invoices.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.invoices, ...second.invoices].map(invoice => invoice.id)).size, 25);
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

test('een betaald en beëindigd abonnement kan dezelfde dag door een ander plan worden gevolgd', async () => {
  await createCheckout(identity, 'maand', deps);
  subscriptionPayment();
  state.subscriptions[0].status = 'canceled';
  state.customer.test_clock = 'clock_alice';
  state.clock = {frozen_time: state.lines[0].period.end + 1};
  Object.assign(state.sessions[0], {status: 'complete', payment_status: 'paid', subscription: 'sub_month'});
  await database.doc('billingAccess/' + uid).set({status: 'expired'});

  const result = await createCheckout(identity, 'halfjaar', deps);
  assert.match(result.url, /^https:\/\/checkout\.stripe\.com\//);
  const checkouts = state.calls.filter(call => call[0] === 'checkout');
  assert.equal(checkouts.length, 2);
  assert.deepEqual(checkouts[1][1].line_items, [{price: 'price_halfjaar', quantity: 1}]);
  assert.equal((await database.doc('billingCheckout/' + uid).get()).data().plan, 'halfjaar');
  assert.equal((await database.doc('boekingen/alice').get()).data().prijs, 0);
  assert.equal(state.invoices.length, 1);
});

test('een recente afgeronde Checkout blijft beschermd bij onbetaalde of niet-bevestigde beëindiging', async () => {
  await createCheckout(identity, 'maand', deps);
  subscriptionPayment();
  state.customer.test_clock = 'clock_alice';
  state.clock = {frozen_time: state.lines[0].period.end + 1};
  const subscription = state.subscriptions[0];
  const session = state.sessions[0];
  Object.assign(session, {status: 'complete', payment_status: 'unpaid', subscription: subscription.id});
  subscription.status = 'canceled';
  await assert.rejects(createCheckout(identity, 'halfjaar', deps), /vorige betaling wordt nog verwerkt/);

  session.payment_status = 'paid';
  subscription.metadata.uid = 'bob-uid';
  await assert.rejects(createCheckout(identity, 'halfjaar', deps), /niet worden gecontroleerd/);

  subscription.metadata.uid = uid;
  subscription.customer = 'cus_bob';
  await assert.rejects(createCheckout(identity, 'halfjaar', deps), /niet worden gecontroleerd/);

  subscription.customer = 'cus_alice';
  delete session.subscription;
  await assert.rejects(createCheckout(identity, 'halfjaar', deps), /vorige betaling wordt nog verwerkt/);
  assert.equal(state.calls.filter(call => call[0] === 'checkout').length, 1);
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
  state.customer.test_clock = 'clock_alice';
  state.clock = {frozen_time: end};
  await processEvent(event('evt_canceled', 'customer.subscription.deleted'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
});

test('een later betaalde jaarfactuur herstelt de betaalde periode van een inmiddels opgezegd abonnement', async () => {
  await boundCustomer(); subscriptionPayment();
  const now = Date.UTC(2028, 11, 24) / 1000;
  const paidEnd = Date.UTC(2029, 11, 23) / 1000;
  state.customer.test_clock = 'clock_alice'; state.clock = {frozen_time: now};
  const subscription = state.subscriptions[0];
  subscription.metadata = meta('jaar');
  subscription.items.data[0].price = state.prices.jaar;
  subscription.status = 'past_due';
  // A previously paid period has ended in Stripe's simulation, although it
  // still lies in the future on the actual server clock.
  state.lines[0].period.end = now - 86400;
  await database.doc('billingAccess/' + uid).set({status: 'active', validUntil: Timestamp.fromMillis((now - 86400) * 1000)});
  await processEvent(event('evt_renewal_failed', 'invoice.payment_failed'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');

  subscription.status = 'canceled';
  state.invoices.unshift({id: 'in_recovered_year', customer: 'cus_alice', status: 'paid'});
  state.lines[0].period.end = paidEnd;
  state.paymentValid = false;
  await processEvent(event('evt_still_processing', 'invoice.paid'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  state.paymentValid = true;
  await processEvent(event('evt_recovered_year', 'invoice.paid'), deps);
  let access = (await database.doc('billingAccess/' + uid).get()).data();
  assert.equal(access.status, 'active');
  assert.equal(access.validUntil.toMillis(), paidEnd * 1000);
  assert.equal(subscription.status, 'canceled');
  assert.equal((await billingOverview(identity, {}, deps)).subscription.nextPaymentAt, null);
  await assert.rejects(createCheckout(identity, 'jaar', deps), /al betaalde toegang/);
  await processEvent(event('evt_late_cancellation', 'customer.subscription.deleted'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'active');

  state.clock.frozen_time = paidEnd;
  await processEvent(event('evt_coverage_finished', 'customer.subscription.deleted'), deps);
  access = (await database.doc('billingAccess/' + uid).get()).data();
  assert.equal(access.status, 'expired');
  assert.equal(state.invoices.length, 2);
  assert.equal((await database.doc('boekingen/alice').get()).data().prijs, 0);
});

test('opzegging wist betaalde resterende tijd niet; terugbetaling en vreemde abonnementen geven geen toegang', async () => {
  await boundCustomer(); const end = subscriptionPayment();
  state.subscriptions[0].status = 'canceled';
  await processEvent(event('evt_paid_cancelled', 'invoice.paid'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().validUntil.toMillis(), end * 1000);
  state.refunded = true;
  await processEvent(event('evt_cancelled_refunded', 'charge.refunded'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
  state.refunded = false; state.subscriptions[0].customer = 'cus_bob';
  await processEvent(event('evt_foreign_subscription', 'invoice.paid'), deps);
  assert.equal((await database.doc('billingAccess/' + uid).get()).data().status, 'expired');
});

test('een onbereikbare simulatieklok bewaart bestaande rechten; live betalingen gebruiken uitsluitend echte tijd', async () => {
  await boundCustomer(); const end = subscriptionPayment();
  const ref = database.doc('billingAccess/' + uid);
  await ref.set({status: 'active', validUntil: Timestamp.fromMillis(end * 1000)});
  const original = (await ref.get()).data();
  state.customer.test_clock = 'clock_alice';
  deps.stripe.testHelpers.testClocks.retrieve = async () => { throw new Error('Simulatie tijdelijk onbereikbaar'); };
  await assert.rejects(processEvent(event('evt_clock_outage'), deps), /tijdelijk/);
  assert.deepEqual((await ref.get()).data(), original);
  assert.equal((await database.doc('billingEvents/evt_clock_outage').get()).exists, false);
  deps.liveMode = true;
  await database.doc('billing/config').update({stripeLiveMode: true});
  await processEvent({...event('evt_live_real_time'), livemode: true}, deps);
  assert.equal((await ref.get()).data().validUntil.toMillis(), end * 1000);
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
  assert.deepEqual(state.calls.at(-1), ['portal', {customer: 'cus_alice', return_url: 'https://app.example.test/app/'}]);
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
