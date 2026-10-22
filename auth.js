/* Firebase owns passwords and sessions. Firestore rules enforce data access. */
var auth = null;
var authProfiel = null;
var authRechten = {};
var authGeneratie = 0;

function isBeheerder() {
  return !!(authProfiel && (authRechten.admin === true || authRechten.beheerder === true));
}

function veiligeFoto(foto) {
  return typeof foto === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(foto) ? foto : '';
}

function authFoutmelding(error) {
  var code = error && error.code;
  if (code === 'auth/too-many-requests') return 'Te veel pogingen. Wacht even en probeer opnieuw.';
  if (code === 'auth/network-request-failed') return 'Geen verbinding. Probeer opnieuw.';
  if (code === 'auth/weak-password') return 'Kies een wachtwoord van minimaal 6 tekens.';
  if (code === 'auth/email-already-in-use') return 'Registreren is niet gelukt. Probeer inloggen of wachtwoord vergeten.';
  if (code === 'auth/operation-not-allowed') return 'Inloggen is nog niet beschikbaar. Neem contact op met de beheerder.';
  return 'Inloggen of registreren is niet gelukt. Controleer je gegevens en probeer opnieuw.';
}

function toggleAuthModus() {
  authModus = authModus === 'login' ? 'register' : 'login';
  var registratie = authModus === 'register';
  document.getElementById('auth-title').textContent = registratie ? 'Registreren' : 'Welkom';
  document.getElementById('auth-subtitle').textContent = registratie ? 'Maak een account aan' : 'Log in met je e-mailadres';
  document.getElementById('auth-user-label').textContent = registratie ? 'Gebruikersnaam' : 'E-mailadres';
  var invoer = document.getElementById('auth-user');
  invoer.type = registratie ? 'text' : 'email';
  invoer.placeholder = registratie ? 'Gebruikersnaam' : 'jouw@email.nl';
  invoer.autocomplete = registratie ? 'nickname' : 'username';
  invoer.value = '';
  document.getElementById('auth-pass').autocomplete = registratie ? 'new-password' : 'current-password';
  document.getElementById('auth-pass').placeholder = registratie ? 'Minimaal 6 tekens' : 'Wachtwoord';
  document.getElementById('auth-btn').textContent = registratie ? 'Account aanmaken' : 'Inloggen';
  ['auth-pass2-group', 'auth-email-group', 'auth-code-group'].forEach(function(id) {
    document.getElementById(id).style.display = registratie ? '' : 'none';
  });
  document.getElementById('auth-onthoud-wrap').style.display = registratie ? 'none' : 'flex';
  document.getElementById('auth-wissel-tekst').textContent = registratie ? 'Al een account? ' : 'Nog geen account? ';
  document.getElementById('auth-wissel').textContent = registratie ? 'Inloggen' : 'Registreren';
  document.getElementById('verificatie-opnieuw').style.display = 'none';
  toonAuthFout('');
  toonAuthSuccess('');
}

async function registreerProfiel(user, gebruiker, code) {
  var codeRef = db.collection('codes').doc(code);
  var mapping = db.collection('authUsers').doc(user.uid);
  await db.runTransaction(async function(transaction) {
    var uitnodiging = await transaction.get(codeRef);
    if (!uitnodiging.exists || uitnodiging.data().gebruikt !== false) {
      throw new Error('Uitnodiging is niet beschikbaar.');
    }
    transaction.set(db.collection('accounts').doc(gebruiker), {
      uid: user.uid, gebruiker: gebruiker, email: user.email,
      aangemaakt: new Date().toISOString(), uitnodigingscode: code
    });
    transaction.set(mapping, {gebruiker: gebruiker});
    transaction.update(codeRef, {gebruikt: true, gebruiker: gebruiker, uid: user.uid});
  });
}

async function authActie() {
  var invoer = document.getElementById('auth-user').value.trim().toLowerCase();
  var pass = document.getElementById('auth-pass').value;
  var registratie = authModus === 'register';
  var email = registratie ? document.getElementById('auth-email').value.trim().toLowerCase() : invoer;
  toonAuthFout(''); toonAuthSuccess('');
  if (!email || !email.includes('@') || !pass) {
    toonAuthFout('Vul je e-mailadres en wachtwoord in.'); return;
  }
  var code = document.getElementById('auth-code').value.trim().toUpperCase();
  if (registratie) {
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(invoer) || ['constructor', 'prototype'].includes(invoer)) { toonAuthFout('Gebruik 3–32 letters, cijfers, streepjes of underscores voor je gebruikersnaam.'); return; }
    if (pass.length < 6) { toonAuthFout('Kies een wachtwoord van minimaal 6 tekens.'); return; }
    if (pass !== document.getElementById('auth-pass2').value) { toonAuthFout('Wachtwoorden komen niet overeen.'); return; }
    if (!/^[A-Z0-9-]{5,64}$/.test(code)) { toonAuthFout('Vul een geldige uitnodigingscode in.'); return; }
  }
  var knop = document.getElementById('auth-btn');
  if (knop.disabled) return;
  knop.disabled = true;
  try {
    await auth.setPersistence(registratie ? firebase.auth.Auth.Persistence.NONE :
      (document.getElementById('auth-onthoud').checked ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION));
    if (registratie) {
      var result = await auth.createUserWithEmailAndPassword(email, pass);
      var profielBewaard = false;
      try {
        await registreerProfiel(result.user, invoer, code);
        profielBewaard = true;
        await result.user.sendEmailVerification();
        toonAuthSuccess('Account aangemaakt. Bevestig je e-mailadres via de verificatiemail en log daarna in.');
      } catch (error) {
        if (!profielBewaard) await result.user.delete().catch(function() {});
        throw error;
      } finally {
        await auth.signOut();
      }
    } else {
      var login = await auth.signInWithEmailAndPassword(email, pass);
      if (!login.user.emailVerified) {
        toonAuthFout('Bevestig eerst je e-mailadres. Je kunt de verificatiemail opnieuw versturen.');
        document.getElementById('verificatie-opnieuw').style.display = '';
        await auth.signOut();
      }
    }
  } catch (error) {
    toonAuthFout(authFoutmelding(error));
  } finally {
    document.getElementById('auth-pass').value = '';
    document.getElementById('auth-pass2').value = '';
    knop.disabled = false;
  }
}

async function verstuurVerificatieOpnieuw() {
  var email = document.getElementById('auth-user').value.trim();
  var pass = document.getElementById('auth-pass').value;
  if (!email || !pass) { toonAuthFout('Vul je e-mailadres en wachtwoord opnieuw in.'); return; }
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    var result = await auth.signInWithEmailAndPassword(email, pass);
    if (!result.user.emailVerified) await result.user.sendEmailVerification();
    toonAuthSuccess('Controleer je inbox voor de verificatiemail.');
  } catch (error) {
    toonAuthFout(authFoutmelding(error));
  } finally {
    await auth.signOut();
    document.getElementById('auth-pass').value = '';
  }
}

async function verstuurWachtwoordReset() {
  var email = document.getElementById('vergeten-user').value.trim();
  var fout = document.getElementById('vergeten-error');
  var succes = document.getElementById('vergeten-success');
  var knop = document.getElementById('vergeten-btn');
  fout.style.display = 'none'; succes.style.display = 'none';
  if (!email.includes('@')) { fout.textContent = 'Vul een geldig e-mailadres in.'; fout.style.display = 'block'; return; }
  knop.disabled = true;
  try {
    await auth.sendPasswordResetEmail(email);
    succes.textContent = 'Als dit e-mailadres bij een account hoort, ontvang je een resetmail.';
    succes.style.display = 'block';
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      succes.textContent = 'Als dit e-mailadres bij een account hoort, ontvang je een resetmail.';
      succes.style.display = 'block';
    } else {
      fout.textContent = authFoutmelding(error); fout.style.display = 'block';
    }
  } finally { knop.disabled = false; }
}

function verbergApp() {
  resetRanglijst();
  if (typeof meldingInterval !== 'undefined' && meldingInterval) clearInterval(meldingInterval);
  document.querySelectorAll('body > .container, .auth-overlay').forEach(function(el) { el.style.display = 'none'; });
  document.querySelectorAll('#bewerk-overlay, #verwijder-gebruiker-overlay').forEach(function(el) { el.style.display = 'none'; });
  document.querySelectorAll('.open').forEach(function(el) { el.classList.remove('open'); });
  zetMenuOpen(false);
  document.getElementById('meer-info-toggle').setAttribute('aria-expanded', 'false');
  huidigeGebruiker = ''; boekingen = []; undoStack = []; logItems = []; meldingen = [];
  pendingBoeking = null; detailBoekingen = []; detailUsername = '';
  boekingOpslaanBezig = false;
  document.getElementById('add-btn').disabled = false;
  document.getElementById('bewerk-opslaan-btn').disabled = false;
  document.getElementById('clear-btn').disabled = false;
  updateUndoBtn();
}

function toonSessieLaden(tekst) {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('sessie-laden-tekst').textContent = tekst || 'Je sessie wordt hersteld…';
  document.getElementById('sessie-laden').hidden = false;
}

function verbergSessieLaden() {
  document.getElementById('sessie-laden').hidden = true;
}

async function uitloggen() {
  if (boekingOpslaanBezig) { voegLogToe('Wacht tot je boeking is opgeslagen.', 'error'); return; }
  try { await auth.signOut(); sessionStorage.removeItem('huidigePagina'); }
  catch (error) { voegLogToe('Uitloggen is niet gelukt. Probeer opnieuw.', 'error'); }
}

function checkSessie() {
  // Legacy browser values never establish an authenticated session.
  localStorage.removeItem('auth_sessie'); sessionStorage.removeItem('auth_sessie');
  auth = firebase.auth();
  if (window.location.hostname === '127.0.0.1' && window.BOEKINGEN_TEST_CONFIG) {
    auth.useEmulator('http://127.0.0.1:9099', {disableWarnings: true});
  }
  auth.onAuthStateChanged(async function(user) {
    var generatie = ++authGeneratie;
    stopAbonnementen();
    authProfiel = null; authRechten = {};
    verbergApp();
    if (!user || !user.emailVerified) {
      document.getElementById('auth-overlay').style.display = 'flex';
      verbergSessieLaden();
      return;
    }
    toonSessieLaden();
    try {
      var profielEnToken = await Promise.all([db.collection('authUsers').doc(user.uid).get(), user.getIdTokenResult()]);
      if (generatie !== authGeneratie || auth.currentUser !== user) return;
      var mapping = profielEnToken[0];
      if (!mapping.exists) throw new Error('profile-missing');
      var gebruiker = mapping.data().gebruiker;
      var account = await db.collection('accounts').doc(gebruiker).get();
      if (!account.exists || account.data().uid !== user.uid) throw new Error('profile-missing');
      var token = profielEnToken[1];
      if (generatie !== authGeneratie || auth.currentUser !== user) return;
      authProfiel = {uid: user.uid, gebruiker: gebruiker};
      authRechten = token.claims;
      var access = await startAbonnementen(user, generatie);
      if (!access || generatie !== authGeneratie) return;
      if (access.allowed) {
        toonSessieLaden('Je gegevens worden geladen…');
        await toonApp(gebruiker);
        // Firestore already verified this session's access. A slower Stripe
        // reconciliation must not keep a valid session on the login screen.
        if (generatie === authGeneratie && access.provider === 'stripe' &&
            (access.prepaid || ['active', 'lifetime'].includes(access.kind) || new URLSearchParams(window.location.search).has('betaling'))) {
          controleerAbonnementen(true).catch(function() {});
        }
      }
      else toonAbonnementKeuze(access);
    } catch (error) {
      if (generatie !== authGeneratie) return;
      if (authProfiel && auth.currentUser === user) {
        abonnementStatus = Object.assign({}, abonnementStatus, {allowed: false});
        toonAbonnementKeuze(abonnementStatus, 'Je gegevens konden niet worden geladen. Klik op Opnieuw controleren.');
        return;
      }
      await auth.signOut();
      toonAuthFout('Je account kon niet worden geladen. Neem contact op met de beheerder als je account nog moet worden overgezet.');
    }
  });
}

function openAdminPaneel() {
  if (!authProfiel || authRechten.admin !== true) { toonAuthFout('Log in met je persoonlijke beheerdersaccount.'); return; }
  document.getElementById('admin-overlay').style.display = 'flex';
  document.getElementById('admin-panel').style.display = 'block';
  renderAdminCodes();
}

function genereerCode() {
  var bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, function(n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
}

async function beveiligdeFetch(url, options) {
  if (!auth || !auth.currentUser || !auth.currentUser.emailVerified) throw new Error('Log eerst in.');
  var token = await auth.currentUser.getIdToken();
  var result = await fetch(url, Object.assign({}, options, {
    headers: Object.assign({}, options && options.headers, {Authorization: 'Bearer ' + token})
  }));
  if (result.status === 402 && url !== '/api/subscription-status') controleerAbonnementen().catch(function() {});
  return result;
}
