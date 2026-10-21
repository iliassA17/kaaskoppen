var abonnementStatus = null;
var abonnementTimer = null;
var abonnementListeners = [];
var abonnementVersie = 0;
var abonnementControle = null;
var abonnementInert = [];

function herstelAbonnementAchtergrond() {
  abonnementInert.forEach(function(entry) { entry.element.inert = entry.inert; });
  abonnementInert = [];
}

function stopAbonnementen() {
  resetAbonnementOverzicht();
  abonnementVersie++;
  clearTimeout(abonnementTimer);
  abonnementListeners.forEach(function(stop) { stop(); });
  abonnementListeners = [];
  abonnementControle = null;
  abonnementStatus = null;
  document.getElementById('proefperiode-info').hidden = true;
  document.getElementById('abonnement-beheren-profiel').hidden = true;
  herstelAbonnementAchtergrond();
  var overlay = document.getElementById('abonnement-overlay');
  if (overlay) overlay.hidden = true;
}

function toonAbonnementKeuze(status, fout) {
  abonnementBeheerOpen = false;
  verbergApp();
  document.getElementById('auth-overlay').style.display = 'none';
  var overlay = document.getElementById('abonnement-overlay');
  document.getElementById('abonnement-titel').textContent = fout ? 'Je toegang controleren' : 'Je proefperiode of abonnement is afgelopen';
  document.getElementById('abonnement-uitleg').textContent = fout ?
    'Je toegang kan tijdelijk niet worden gecontroleerd. Probeer het opnieuw.' :
    'Je proefperiode duurt zeven dagen. Kies een abonnement om Boekingsschema verder te gebruiken. Je bestaande boekingen blijven bewaard.';
  if (!fout && new URLSearchParams(window.location.search).get('betaling') === 'geslaagd') {
    document.getElementById('abonnement-uitleg').textContent = 'Je bent terug van de betaalpagina. We controleren je betaling bij Stripe. Klik zo nodig op Opnieuw controleren. Je boekingen blijven bewaard.';
  }
  var error = document.getElementById('abonnement-error');
  error.textContent = fout || '';
  error.hidden = !fout;
  var container = document.getElementById('abonnement-opties');
  container.replaceChildren();
  ((status && status.plans) || SubscriptionAccess.planOptions(null)).forEach(function(plan) {
    var card = document.createElement('div');
    card.className = 'abonnement-optie';
    var title = document.createElement('h3');
    title.textContent = plan.label;
    var price = document.createElement('div');
    price.className = 'abonnement-prijs';
    price.textContent = plan.amountCents == null ? 'Prijs nog niet ingesteld' :
      new Intl.NumberFormat('nl-NL', {style: 'currency', currency: 'EUR'}).format(plan.amountCents / 100);
    var interval = document.createElement('p');
    interval.textContent = plan.months === null ? 'Eenmalig betalen' :
      (plan.months === 1 ? 'Iedere maand, tot je opzegt' : 'Iedere ' + plan.months + ' maanden, tot je opzegt');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'auth-btn';
    button.textContent = 'Kies ' + plan.label.toLowerCase();
    button.dataset.plan = plan.id;
    button.disabled = !!fout || plan.amountCents == null;
    button.addEventListener('click', function() { startAbonnementBetaling(plan.id); });
    card.append(title, price, interval, button);
    container.appendChild(card);
  });
  document.getElementById('abonnement-btw').textContent = status && status.taxIncluded ? 'Alle prijzen zijn inclusief btw.' : '';
  if (!abonnementInert.length) {
    Array.from(document.body.children).forEach(function(element) {
      if (element === overlay || ['SCRIPT', 'STYLE'].includes(element.tagName)) return;
      abonnementInert.push({element: element, inert: element.inert});
      element.inert = true;
    });
  }
  overlay.hidden = false;
  document.getElementById('abonnement-dialoog').focus();
}

async function openStripePagina(endpoint, plan, host, feedback) {
  var generatie = authGeneratie, uid = auth && auth.currentUser && auth.currentUser.uid;
  var error = feedback || document.getElementById('abonnement-error');
  var buttons = Array.from(document.querySelectorAll('#abonnement-dialoog button, #abonnement-beheren-profiel, #abonnement-portaal-openen'));
  var disabled = buttons.map(function(button) { return button.disabled; });
  buttons.forEach(function(button) { button.disabled = true; });
  error.hidden = true;
  try {
    var response = await beveiligdeFetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(plan ? {plan: plan} : {})});
    var data = await response.json();
    if (generatie !== authGeneratie || !auth.currentUser || auth.currentUser.uid !== uid) return;
    if (!response.ok) throw new Error(data.error || 'De betaalpagina kan niet worden geopend.');
    var target = new URL(data.url);
    if (target.protocol !== 'https:' || target.hostname !== host || target.username || target.password || target.port) {
      throw new Error('De betaalpagina kan niet veilig worden geopend.');
    }
    window.location.assign(target.href);
  } catch (failure) {
    error.textContent = failure.message || 'De betaalpagina kan tijdelijk niet worden geopend. Probeer opnieuw.';
    error.hidden = false;
  } finally {
    buttons.forEach(function(button, index) { button.disabled = disabled[index]; });
  }
}

function startAbonnementBetaling(plan) {
  return openStripePagina('/api/create-checkout-session', plan, 'checkout.stripe.com');
}
function beheerAbonnement() {
  return openStripePagina('/api/create-portal-session', null, 'billing.stripe.com');
}

async function haalAbonnementStatus() {
  var response = await beveiligdeFetch('/api/subscription-status', {method: 'POST'});
  var data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Je toegang kan niet worden gecontroleerd.');
  if (typeof data.allowed !== 'boolean' || !Number.isFinite(data.serverNow)) throw new Error('Ongeldig antwoord bij toegangscontrole.');
  return data;
}

function planAbonnementControle(status) {
  clearTimeout(abonnementTimer);
  var info = document.getElementById('proefperiode-info');
  info.hidden = status.kind !== 'trial' || !status.allowed;
  if (!info.hidden) info.textContent = 'Je gratis proefweek loopt tot ' +
    new Date(status.expiresAt).toLocaleString('nl-NL', {day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'}) + '. Daarna kies je zelf of je verdergaat met een betaaloptie.';
  document.getElementById('abonnement-beheren-profiel').hidden = !status.enabled;
  document.getElementById('abonnement-beheren').hidden = !authProfiel;
  if (!status.allowed || !Number.isFinite(status.expiresAt)) return;
  var delay = Math.max(100, Math.min(60000, status.expiresAt - status.serverNow + 100));
  abonnementTimer = setTimeout(function() { controleerAbonnementen().catch(function() {}); }, delay);
}

async function controleerAbonnementen() {
  if (abonnementControle) return abonnementControle;
  var versie = abonnementVersie, generatie = authGeneratie;
  abonnementControle = (async function() {
    try {
      var previous = abonnementStatus;
      var status = await haalAbonnementStatus();
      if (versie !== abonnementVersie || generatie !== authGeneratie) return null;
      abonnementStatus = status;
      planAbonnementControle(status);
      if (!status.allowed) {
        if (abonnementBeheerOpen) toonBeheerZonderToegang();
        else toonAbonnementKeuze(status);
      }
      else if (previous && !previous.allowed && !abonnementBeheerOpen) {
        document.getElementById('abonnement-overlay').hidden = true;
        herstelAbonnementAchtergrond();
        await toonApp(authProfiel.gebruiker);
      }
      return status;
    } catch (error) {
      if (versie === abonnementVersie && generatie === authGeneratie) {
        abonnementStatus = Object.assign({}, abonnementStatus, {allowed: false});
        if (abonnementBeheerOpen) toonBeheerZonderToegang();
        else toonAbonnementKeuze(abonnementStatus, 'Je toegang kan tijdelijk niet worden gecontroleerd. Klik op Opnieuw controleren.');
      }
      throw error;
    } finally {
      if (versie === abonnementVersie) abonnementControle = null;
    }
  })();
  return abonnementControle;
}

async function startAbonnementen(user, generatie) {
  stopAbonnementen();
  var versie = abonnementVersie;
  try {
    return await controleerAbonnementen();
  } catch {
    // The retry dialog is already visible. Keep the authenticated session so
    // a temporary outage does not require a new login or restart the trial.
    return null;
  } finally {
    if (versie === abonnementVersie && generatie === authGeneratie) {
      ['billing/config', 'billingAccess/' + user.uid].forEach(function(path) {
        var stop = db.doc(path).onSnapshot(function() {
          // Include the first snapshot: configuration may have changed between
          // the status request and subscribing to this document.
          if (versie === abonnementVersie && generatie === authGeneratie) controleerAbonnementen().catch(function() {});
        }, function() {
          if (versie === abonnementVersie && generatie === authGeneratie) controleerAbonnementen().catch(function() {});
        });
        abonnementListeners.push(stop);
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('abonnement-opnieuw').addEventListener('click', function() { controleerAbonnementen().catch(function() {}); });
  document.getElementById('abonnement-uitloggen').addEventListener('click', uitloggen);
  document.getElementById('abonnement-beheren').addEventListener('click', openAbonnementOverzicht);
  document.getElementById('abonnement-beheren-profiel').addEventListener('click', openAbonnementOverzicht);
  document.getElementById('abonnement-dialoog').addEventListener('keydown', function(event) {
    if (event.key !== 'Tab') return;
    var buttons = Array.from(this.querySelectorAll('button:not([disabled])')).filter(function(button) { return !button.hidden; });
    if (!buttons.length) { event.preventDefault(); return; }
    var first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === this)) {
      event.preventDefault(); first.focus();
    }
  });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && authProfiel && auth.currentUser) controleerAbonnementen().catch(function() {});
  });
});
