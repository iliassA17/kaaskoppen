const {BillingError, dependencies, configuration, validPrice, matches} = require('./billing.cjs');
const model = require('../../subscription-access.js');

const objectId = value => typeof value === 'string' ? value : value?.id;
const milliseconds = seconds => Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
function stripeLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['invoice.stripe.com', 'pay.stripe.com', 'files.stripe.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

async function billingOverview(identity, {after = null} = {}, deps = dependencies()) {
  if (after !== null && (typeof after !== 'string' || !/^in_[A-Za-z0-9_]{1,200}$/.test(after))) {
    throw new BillingError('De volgende factuurpagina kan niet worden geopend.', 400);
  }
  const uid = identity.user.uid;
  const mapping = (await deps.database.doc('authUsers/' + uid).get()).data();
  if (!mapping?.gebruiker || (await deps.database.collection('accounts').doc(mapping.gebruiker).get()).data()?.uid !== uid) {
    throw new BillingError('Je account kan niet worden gecontroleerd.', 403);
  }
  const config = await configuration(deps, false);
  const access = (await deps.database.doc('billingAccess/' + uid).get()).data();
  const state = model.accessState(config, access, Date.now(), identity.user.admin === true);
  const result = {access: state, subscription: null, invoices: [], nextCursor: null, hasCustomer: false,
    plans: model.planOptions(config), taxIncluded: config.taxIncluded === true};
  const record = (await deps.database.doc('billingCustomers/' + uid).get()).data();
  if (!record?.customerId) return result;
  const customer = await deps.stripe.customers.retrieve(record.customerId);
  if (customer.deleted || customer.id !== record.customerId || !matches(customer.metadata, uid, deps.projectId)) {
    throw new BillingError('Je betaalaccount kan niet worden gecontroleerd.');
  }
  result.hasCustomer = true;
  if (after) {
    let cursor;
    try { cursor = await deps.stripe.invoices.retrieve(after); }
    catch (error) {
      if (error.statusCode === 404) throw new BillingError('Ongeldige factuurpagina.', 400);
      throw error;
    }
    if (objectId(cursor?.customer) !== customer.id) throw new BillingError('Ongeldige factuurpagina.', 400);
  }
  // Both requests are scoped to the server-side customer binding, never to a
  // customer ID supplied by the browser. Pagination never follows foreign IDs.
  const [subscriptions, page] = await Promise.all([
    deps.stripe.subscriptions.list({customer: customer.id, status: 'all', limit: 100}),
    deps.stripe.invoices.list({customer: customer.id, limit: 20, ...(after ? {starting_after: after} : {})}),
  ]);
  if (subscriptions.has_more) throw new BillingError('Je abonnementshistorie vereist controle door de beheerder.');
  const candidates = subscriptions.data.filter(subscription => {
    const plan = subscription.metadata?.plan, items = subscription.items?.data;
    return objectId(subscription.customer) === customer.id && matches(subscription.metadata, uid, deps.projectId) &&
      Object.hasOwn(model.PLANS, plan || '') && plan !== 'levenslang' && items?.length === 1 &&
      items[0].quantity === 1 && validPrice(items[0].price, plan, deps.projectId);
  }).sort((left, right) => {
    const ended = subscription => ['canceled', 'incomplete_expired'].includes(subscription.status) ? 1 : 0;
    return ended(left) - ended(right) || (right.created || 0) - (left.created || 0);
  });
  const subscription = candidates[0];
  if (state.kind === 'lifetime') {
    result.subscription = {plan: 'levenslang', label: model.PLANS.levenslang.label,
      amountCents: config.plans?.levenslang?.amountCents ?? null, currency: 'EUR', status: 'lifetime',
      currentPeriodEnd: null, nextPaymentAt: null, cancelAt: null, cancelAtPeriodEnd: false};
  } else if (subscription) {
    const item = subscription.items.data[0];
    const cancelled = subscription.cancel_at_period_end === true || subscription.cancel_at != null;
    result.subscription = {plan: subscription.metadata.plan, label: model.PLANS[subscription.metadata.plan].label,
      amountCents: item.price.unit_amount, currency: item.price.currency.toUpperCase(), status: subscription.status,
      startedAt: milliseconds(subscription.start_date), currentPeriodEnd: milliseconds(item.current_period_end),
      nextPaymentAt: !cancelled && ['active', 'trialing'].includes(subscription.status) ? milliseconds(item.current_period_end) : null,
      cancelAt: milliseconds(subscription.cancel_at), cancelAtPeriodEnd: cancelled};
  }
  for (const invoice of page.data) {
    if (objectId(invoice.customer) !== customer.id) throw new BillingError('Je facturen kunnen niet veilig worden gecontroleerd.');
    if (invoice.status === 'draft') continue;
    result.invoices.push({id: invoice.id, number: invoice.number || invoice.id,
      status: invoice.status, currency: invoice.currency?.toUpperCase() || 'EUR',
      totalCents: invoice.total, paidCents: invoice.amount_paid, remainingCents: invoice.amount_remaining,
      createdAt: milliseconds(invoice.created), paidAt: milliseconds(invoice.status_transitions?.paid_at),
      dueAt: milliseconds(invoice.due_date), nextAttemptAt: milliseconds(invoice.next_payment_attempt),
      pdfUrl: stripeLink(invoice.invoice_pdf), paymentUrl: stripeLink(invoice.hosted_invoice_url)});
  }
  result.nextCursor = page.has_more && page.data.length ? page.data.at(-1).id : null;
  return result;
}

module.exports = {billingOverview};
