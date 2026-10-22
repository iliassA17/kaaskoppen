var abonnementBeheerOpen = false;
var abonnementOverzichtVersie = 0;
var abonnementOverzichtData = null;

function resetAbonnementOverzicht() {
  abonnementBeheerOpen = false;
  abonnementOverzichtVersie++;
  abonnementOverzichtData = null;
  document.getElementById('abonnement-facturen-lijst').replaceChildren();
  document.getElementById('abonnement-overzicht-inhoud').hidden = true;
  document.getElementById('abonnement-overzicht-fout').hidden = true;
  document.getElementById('abonnement-overzicht-laden').hidden = true;
  ['abonnement-huidig-naam', 'abonnement-huidig-status', 'abonnement-huidig-prijs', 'abonnement-huidig-periode',
    'abonnement-volgend-bedrag', 'abonnement-volgend-datum', 'abonnement-volgend-uitleg'].forEach(function(id) {
    document.getElementById(id).textContent = '';
  });
  document.getElementById('pagina-abonnement').setAttribute('aria-busy', 'false');
}

function toonBeheerZonderToegang() {
  verbergApp();
  document.getElementById('auth-overlay').style.display = 'none';
  toonPagina('abonnement');
  document.getElementById('hamburger-btn-abonnement').hidden = true;
}

function openAbonnementOverzicht() {
  if (!authProfiel || !auth || !auth.currentUser || !auth.currentUser.emailVerified) return;
  herstelAbonnementAchtergrond();
  document.getElementById('abonnement-overlay').hidden = true;
  document.getElementById('auth-overlay').style.display = 'none';
  toonPagina('abonnement');
  document.getElementById('hamburger-btn-abonnement').hidden = !abonnementStatus || !abonnementStatus.allowed;
  document.getElementById('abonnement-pagina-titel').focus();
  return laadAbonnementOverzicht(false);
}

async function sluitAbonnementOverzicht() {
  if (!authProfiel || !auth.currentUser) return;
  var generation = authGeneratie;
  if (!abonnementStatus || !abonnementStatus.allowed) {
    toonAbonnementKeuze(abonnementStatus, abonnementStatus && ['expired', 'missing'].includes(abonnementStatus.kind) ? null : 'Controleer je toegang opnieuw.');
    return;
  }
  abonnementBeheerOpen = false;
  sessionStorage.setItem('huidigePagina', 'schema');
  try { await toonApp(authProfiel.gebruiker); }
  catch {
    if (generation === authGeneratie && authProfiel && auth.currentUser) {
      toonAbonnementKeuze(abonnementStatus, 'Je gegevens konden niet worden geladen. Klik op Opnieuw controleren.');
    }
  }
}

function factuurBedrag(cents, currency) {
  if (!Number.isSafeInteger(cents)) return '—';
  try { return new Intl.NumberFormat('nl-NL', {style: 'currency', currency: currency || 'EUR'}).format(cents / 100); }
  catch { return '—'; }
}
function factuurDatum(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toLocaleDateString('nl-NL',
    {day: 'numeric', month: 'long', year: 'numeric'}) : 'Geen datum bekend';
}
function factuurLink(value) {
  try {
    var url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['invoice.stripe.com', 'pay.stripe.com', 'files.stripe.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function renderAbonnementSamenvatting(data) {
  var access = data.access, subscription = data.subscription;
  var kinds = {trial: 'Gratis proefweek', free: 'Gratis blijvende toegang', admin: 'Beheerderstoegang',
    lifetime: 'Voor altijd', disabled: 'Toegang zonder abonnement', expired: 'Toegang verlopen', missing: 'Nog geen abonnement'};
  var name = subscription ? subscription.label : (kinds[access.kind] || 'Je abonnement');
  document.getElementById('abonnement-huidig-naam').textContent = name;
  var status = document.getElementById('abonnement-huidig-status');
  var statuses = {active: 'Actief', past_due: 'Betaling achterstallig', canceled: 'Opgezegd', unpaid: 'Onbetaald',
    incomplete: 'Betaling nog niet afgerond', incomplete_expired: 'Betaling verlopen', trialing: 'Proefperiode', lifetime: 'Levenslang'};
  status.textContent = access.kind === 'trial' ? 'Proefweek actief' :
    (subscription && subscription.status === 'canceled' ? (access.kind === 'active' && access.allowed ? 'Betaalde toegang · opgezegd' : 'Opgezegd') :
      subscription && subscription.cancelAtPeriodEnd ? (access.allowed ? 'Opgezegd · loopt nog' : 'Opgezegd') :
      !access.allowed ? 'Toegang verlopen' : subscription ? statuses[subscription.status] || 'In behandeling' : 'Actief');
  status.className = 'factuur-status ' + (access.allowed ? 'betaald' : 'openstaand');
  var price = '', period = '';
  if (subscription) {
    var months = SubscriptionAccess.PLANS[subscription.plan].months;
    price = factuurBedrag(subscription.amountCents, subscription.currency) +
      (months === null ? ' eenmalig' : months === 1 ? ' per maand' : ' per ' + months + ' maanden') +
      (data.taxIncluded ? ' · inclusief btw' : '');
    var comparison = abonnementPrijsVergelijking({months: months, amountCents: subscription.amountCents}, data.plans);
    if (comparison && subscription.currency === 'EUR') price += ' ' + comparison.monthly;
    if (subscription.status === 'canceled' && access.kind === 'active' && access.allowed) {
      period = 'Je betaalde toegang loopt tot ' + factuurDatum(access.expiresAt) + '. Je abonnement wordt niet automatisch verlengd.';
    } else if (subscription.cancelAtPeriodEnd) period = 'Opgezegd. Je abonnement stopt op ' +
      factuurDatum(subscription.cancelAt || subscription.currentPeriodEnd) + '.';
    else if (access.expiresAt) period = 'Je betaalde toegang loopt tot ' + factuurDatum(access.expiresAt) + '.';
    if (access.kind === 'trial') period = 'Je gratis proefweek loopt tot ' + factuurDatum(access.expiresAt) + '.';
  } else if (access.kind === 'trial') {
    price = '€ 0,00 tijdens je proefweek';
    period = 'Je proefweek loopt tot ' + factuurDatum(access.expiresAt) + '. Daarna kies je zelf of je verdergaat.';
  } else if (['free', 'admin'].includes(access.kind)) {
    price = '€ 0,00 · blijvend'; period = 'Voor deze toegang hoef je geen abonnement af te sluiten.';
  } else if (access.kind === 'lifetime') {
    price = 'Eenmalig betaald · geen verlenging';
  } else if (access.expiresAt) period = 'Je toegang is afgelopen op ' + factuurDatum(access.expiresAt) + '.';
  document.getElementById('abonnement-huidig-prijs').textContent = price;
  document.getElementById('abonnement-huidig-periode').textContent = period;
  var next = subscription && subscription.nextPaymentAt;
  var outstanding = data.invoices.filter(function(invoice) { return invoice.status === 'open' && invoice.remainingCents > 0; })
    .sort(function(left, right) { return (left.nextAttemptAt || left.dueAt || left.createdAt || 0) - (right.nextAttemptAt || right.dueAt || right.createdAt || 0); })[0];
  var outstandingDate = outstanding && (outstanding.nextAttemptAt || outstanding.dueAt);
  var showOutstanding = outstanding && (!next || !outstandingDate || outstandingDate <= next);
  document.getElementById('abonnement-volgend-label').textContent = showOutstanding ? 'Openstaande betaling' : 'Volgende betaling';
  document.getElementById('abonnement-volgend-bedrag').textContent = showOutstanding ?
    factuurBedrag(outstanding.remainingCents, outstanding.currency) : next ?
    factuurBedrag(subscription.amountCents, subscription.currency) : 'Geen betaling gepland';
  document.getElementById('abonnement-volgend-datum').textContent = showOutstanding ?
    (outstanding.nextAttemptAt ? 'Volgende betaalpoging op ' + factuurDatum(outstanding.nextAttemptAt) :
      outstanding.dueAt ? 'Vervaldatum: ' + factuurDatum(outstanding.dueAt) : 'Er is nog geen betaaldatum bekend.') :
    next ? 'Verwacht op ' + factuurDatum(next) : '';
  document.getElementById('abonnement-volgend-uitleg').textContent = showOutstanding ?
    'Factuur ' + outstanding.number + ' is nog niet volledig betaald. Je kunt de factuur hieronder bekijken en betalen.' : next ?
    'Verwachte verlenging van je abonnement. Openstaande facturen vind je hieronder.' :
    access.kind === 'trial' ? 'Na de proefweek kies je zelf een betaaloptie. Er wordt nu niets automatisch afgeschreven.' :
    subscription && (subscription.cancelAtPeriodEnd || subscription.status === 'canceled') ? 'Je abonnement wordt niet opnieuw verlengd.' :
    ['free', 'admin', 'lifetime'].includes(access.kind) ? 'Je hoeft je toegang niet periodiek te verlengen.' :
    'Een eventuele openstaande betaling vind je bij je facturen.';
  document.getElementById('abonnement-portaal-openen').hidden = !data.hasCustomer;
  document.getElementById('abonnement-betaalopties-openen').hidden = access.allowed;
}

function renderEigenFacturen(data) {
  var list = document.getElementById('abonnement-facturen-lijst');
  list.replaceChildren();
  var labels = {paid: 'Betaald', open: 'Nog te betalen', void: 'Vervallen', uncollectible: 'Oninbaar'};
  data.invoices.forEach(function(invoice) {
    var card = document.createElement('article'); card.className = 'factuur-kaart';
    var header = document.createElement('div'); header.className = 'factuur-kop';
    var title = document.createElement('h3'); title.textContent = 'Factuur ' + invoice.number;
    var status = document.createElement('span');
    status.textContent = labels[invoice.status] || 'In behandeling';
    status.className = 'factuur-status ' + ({paid: 'betaald', open: 'openstaand', uncollectible: 'oninbaar'}[invoice.status] || '');
    header.append(title, status); card.appendChild(header);
    var details = document.createElement('dl'); details.className = 'factuur-details';
    function field(label, value) {
      var container = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label; description.textContent = value; container.append(term, description); details.appendChild(container);
    }
    field('Factuurbedrag', factuurBedrag(invoice.totalCents, invoice.currency));
    field('Factuurdatum', factuurDatum(invoice.createdAt));
    if (invoice.status === 'paid') {
      field('Betaald op', invoice.paidAt ? factuurDatum(invoice.paidAt) : 'Datum niet beschikbaar');
      field('Betaald bedrag', factuurBedrag(invoice.paidCents, invoice.currency));
    } else if (['open', 'uncollectible'].includes(invoice.status)) {
      field('Nog te betalen', factuurBedrag(invoice.remainingCents, invoice.currency));
      if (invoice.dueAt) field('Vervaldatum', factuurDatum(invoice.dueAt));
      else if (invoice.nextAttemptAt) field('Volgende betaalpoging', factuurDatum(invoice.nextAttemptAt));
    }
    card.appendChild(details);
    var actions = document.createElement('div'); actions.className = 'factuur-acties';
    function link(label, value, primary) {
      var url = factuurLink(value); if (!url) return;
      var anchor = document.createElement('a'); anchor.textContent = label; anchor.href = url;
      anchor.className = 'factuur-knop' + (primary ? ' primair' : ''); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      actions.appendChild(anchor);
    }
    link('Download factuur (PDF)', invoice.pdfUrl, false);
    link(invoice.status === 'open' && invoice.remainingCents > 0 ? 'Factuur betalen' : 'Online bekijken',
      invoice.paymentUrl, invoice.status === 'open' && invoice.remainingCents > 0);
    if (actions.childNodes.length) card.appendChild(actions);
    list.appendChild(card);
  });
  var empty = document.getElementById('abonnement-facturen-leeg');
  empty.hidden = data.invoices.length !== 0;
  empty.textContent = data.access.kind === 'trial' ?
    'Nog geen facturen. Tijdens je gratis proefweek betaal je geen abonnementskosten. Je facturen verschijnen hier zodra je een betaling hebt gedaan of er een factuur openstaat.' :
    ['free', 'admin'].includes(data.access.kind) ? 'Nog geen facturen. Voor je gratis blijvende toegang worden geen abonnementskosten berekend.' :
    'Er zijn nog geen facturen beschikbaar. Een nieuwe factuur kan na een betaling even op zich laten wachten.';
  document.getElementById('abonnement-facturen-meer').hidden = !data.nextCursor;
}

async function laadAbonnementOverzicht(append) {
  if (!abonnementBeheerOpen || !auth.currentUser) return;
  var version = ++abonnementOverzichtVersie, generation = authGeneratie, uid = auth.currentUser.uid;
  var after = append && abonnementOverzichtData ? abonnementOverzichtData.nextCursor : null;
  var error = document.getElementById('abonnement-overzicht-fout');
  var loading = document.getElementById('abonnement-overzicht-laden');
  var page = document.getElementById('pagina-abonnement');
  error.hidden = true; loading.hidden = false; page.setAttribute('aria-busy', 'true');
  document.getElementById('abonnement-overzicht-verversen').disabled = true;
  document.getElementById('abonnement-facturen-meer').disabled = true;
  if (!append) document.getElementById('abonnement-overzicht-inhoud').hidden = true;
  try {
    var response = await beveiligdeFetch('/api/billing-overview', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(after ? {after: after} : {})});
    var data = await response.json();
    if (version !== abonnementOverzichtVersie || generation !== authGeneratie || !auth.currentUser || auth.currentUser.uid !== uid || !abonnementBeheerOpen) return;
    if (!response.ok) throw new Error(data.error || 'Je abonnement en facturen konden niet worden geladen.');
    if (!data.access || !Array.isArray(data.invoices)) throw new Error('Je factuurgegevens zijn tijdelijk niet beschikbaar.');
    if (append && abonnementOverzichtData) {
      var ids = new Set(abonnementOverzichtData.invoices.map(function(invoice) { return invoice.id; }));
      data.invoices = abonnementOverzichtData.invoices.concat(data.invoices.filter(function(invoice) { return !ids.has(invoice.id); }));
    }
    abonnementOverzichtData = data;
    renderAbonnementSamenvatting(data); renderEigenFacturen(data);
    document.getElementById('abonnement-overzicht-inhoud').hidden = false;
  } catch (failure) {
    if (version === abonnementOverzichtVersie && generation === authGeneratie && abonnementBeheerOpen) {
      error.textContent = failure.message || 'Je abonnement en facturen konden niet worden geladen.'; error.hidden = false;
    }
  } finally {
    if (version === abonnementOverzichtVersie && generation === authGeneratie) {
      loading.hidden = true; page.setAttribute('aria-busy', 'false');
      document.getElementById('abonnement-overzicht-verversen').disabled = false;
      document.getElementById('abonnement-facturen-meer').disabled = false;
    }
  }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('menu-abonnement').addEventListener('click', openAbonnementOverzicht);
  document.getElementById('abonnement-pagina-terug').addEventListener('click', sluitAbonnementOverzicht);
  document.getElementById('abonnement-betaalopties-openen').addEventListener('click', function() { toonAbonnementKeuze(abonnementStatus); });
  document.getElementById('abonnement-overzicht-verversen').addEventListener('click', function() { laadAbonnementOverzicht(false); });
  document.getElementById('abonnement-facturen-meer').addEventListener('click', function() { laadAbonnementOverzicht(true); });
  document.getElementById('abonnement-portaal-openen').addEventListener('click', function() {
    openStripePagina('/api/create-portal-session', null, 'billing.stripe.com', document.getElementById('abonnement-overzicht-fout'));
  });
});
