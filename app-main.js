// Firebase initialiseren
var firebaseConfig = {
  apiKey: "AIzaSyC6mnjCOrhXb8GD8s5CKjgEhsr0izoOjz4",
  authDomain: "boekingsschema.firebaseapp.com",
  projectId: "boekingsschema",
  storageBucket: "boekingsschema.firebasestorage.app",
  messagingSenderId: "938972812899",
  appId: "1:938972812899:web:0df65f9e88f147a6a04a56"
};
if (window.location.hostname === '127.0.0.1' && window.BOEKINGEN_TEST_CONFIG) {
  firebaseConfig = window.BOEKINGEN_TEST_CONFIG;
}
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();
if (window.location.hostname === '127.0.0.1' && window.BOEKINGEN_TEST_CONFIG) {
  db.useEmulator('127.0.0.1', 8080);
}

function boekingData(boeking, gebruiker) {
  var data = Object.assign({}, boeking);
  if (gebruiker !== undefined) data.gebruiker = gebruiker;
  delete data._documentId;
  return data;
}

function zelfdeBoeking(a, b) {
  function gesorteerd(key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      var result = Object.create(null);
      Object.keys(value).sort().forEach(function(k) { result[k] = value[k]; });
      return result;
    }
    return value;
  }
  return JSON.stringify(a, gesorteerd) === JSON.stringify(b, gesorteerd);
}

function boekingOpslagFout(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function slaOp(gebruiker, lijst, vorigeLijst) {
  gebruiker = gebruiker || huidigeGebruiker;
  lijst = lijst || JSON.parse(JSON.stringify(boekingen));
  var generatie = authGeneratie;
  var ref = db.collection('boekingen');
  function opId(boekingsLijst) {
    var records = new Map();
    boekingsLijst.forEach(function(b) {
      var id = b._documentId || (gebruiker+'_'+b.datumStr+'_'+b.start+'_tv'+(b.tijdvak == null ? 0 : b.tijdvak));
      if (records.has(id)) throw boekingOpslagFout('invalid-argument');
      records.set(id, boekingData(b, gebruiker));
    });
    return records;
  }
  var vorige = opId(vorigeLijst || []), volgende = opId(lijst);
  var wijzigingen = [];
  var ids = new Set(Array.from(vorige.keys()).concat(Array.from(volgende.keys())));
  ids.forEach(function(id) {
    var voor = vorige.get(id), na = volgende.get(id);
    if (!zelfdeBoeking(voor, na)) wijzigingen.push({ref: ref.doc(id), voor: voor, na: na});
  });
  if (!wijzigingen.length) return Promise.resolve();
  if (wijzigingen.length > 400) return Promise.reject(boekingOpslagFout('resource-exhausted'));
  // Read only the documents this action changes. Existing legacy records and
  // unrelated changes on another device must never be rewritten or removed.
  return db.runTransaction(function(transaction) {
    return Promise.all(wijzigingen.map(function(w) { return transaction.get(w.ref); })).then(function(snapshots) {
      if (generatie !== authGeneratie || gebruiker !== huidigeGebruiker) throw boekingOpslagFout('unauthenticated');
      wijzigingen.forEach(function(w, i) {
        var snap = snapshots[i];
        var actueel = snap.exists ? boekingData(snap.data()) : undefined;
        if (zelfdeBoeking(actueel, w.na)) return; // An earlier attempt may already have succeeded.
        if (!zelfdeBoeking(actueel, w.voor)) throw boekingOpslagFout('aborted');
        if (w.na) transaction.set(w.ref, w.na);
        else transaction.delete(w.ref);
      });
    });
  });
}
function laadBoekingen() {
  var gebruiker = huidigeGebruiker, generatie = authGeneratie;
  return db.collection('boekingen').where('gebruiker','==',gebruiker).get().then(function(snap) {
    if (generatie !== authGeneratie || gebruiker !== huidigeGebruiker) return;
    boekingen = snap.docs.map(function(d){ return Object.assign({}, d.data(), {_documentId: d.id}); });
  });
}
function syncTijdvakFormSelect() {
  var tvSel = document.getElementById('tijdvak-select');
  var tvGroep = document.getElementById('tijdvak-form-groep');
  if (!tvSel || !tvGroep) return;
  tvGroep.style.display = MAX_TIJDVAKKEN > 1 ? '' : 'none';
  var tvOpts = '';
  for (var j = 0; j < MAX_TIJDVAKKEN; j++) {
    var nm = TIJDVAK_NAMEN[j] || ('Tijdvak ' + (j+1));
    tvOpts += '<option value="' + j + '">' + escHtml(nm) + '</option>';
  }
  tvSel.innerHTML = tvOpts;
}

function laadInstellingen() {
  var gebruiker = huidigeGebruiker, generatie = authGeneratie;
  return db.collection('instellingen').doc(gebruiker).get().then(function(doc) {
    if (generatie !== authGeneratie || gebruiker !== huidigeGebruiker) return;
    MIN_GAP=95; DUUR=95; OPEN=540; SLUIT=1440; STANDAARD_PRIJS=10;
    MAX_TIJDVAKKEN=1; TIJDVAK_NAMEN=['Tijdvak 1'];
    MELDING_RICHTING='na'; MELDING_MINUTEN=15; PUSH_NIEUWS=true; PUSH_ACHTERAF=true;
    if (doc.exists) {
      var i=doc.data();
      if(i.minGap!=null) MIN_GAP=i.minGap;
      DUUR=MIN_GAP;
      if(i.open!=null) OPEN=i.open;
      if(i.sluit!=null) SLUIT=(i.sluit===0?1440:i.sluit);
      if(i.standaardPrijs!=null) STANDAARD_PRIJS=i.standaardPrijs;
      if(i.maxTijdvakken!=null) MAX_TIJDVAKKEN=i.maxTijdvakken;
      if(i.tijdvakNamen && i.tijdvakNamen.length) TIJDVAK_NAMEN=i.tijdvakNamen;
      if(i.meldingRichting) MELDING_RICHTING=i.meldingRichting;
      if(i.meldingMinuten!=null) MELDING_MINUTEN=i.meldingMinuten;
      if(i.pushNieuws!=null) PUSH_NIEUWS=i.pushNieuws;
      if(i.pushAchteraf!=null) PUSH_ACHTERAF=i.pushAchteraf;
    }
    updateRulesCard();
    syncTijdvakFormSelect();
    document.getElementById('prijs-input').value = STANDAARD_PRIJS;
  });
}
function slaInstellingenOp(minGap, open, sluit, standaardPrijs, maxTijdvakken, tijdvakNamen) {
  return db.collection('instellingen').doc(huidigeGebruiker).set({
    minGap:minGap, open:open, sluit:sluit, standaardPrijs:standaardPrijs,
    maxTijdvakken:maxTijdvakken || 1, tijdvakNamen:tijdvakNamen || ['Tijdvak 1']
  }, {merge:true}).then(function() {
    MIN_GAP=minGap; DUUR=minGap; OPEN=open; SLUIT=sluit; STANDAARD_PRIJS=standaardPrijs;
    MAX_TIJDVAKKEN=maxTijdvakken || 1;
    TIJDVAK_NAMEN=tijdvakNamen || ['Tijdvak 1'];
    updateRulesCard();
    syncTijdvakFormSelect();
  });
}

function getAccount(user) {
  return db.collection('accounts').doc(user).get().then(function(doc){ return doc.exists?doc.data():null; });
}

function updateAccount(user, data) {
  return db.collection('accounts').doc(user).update(data);
}
function getCodes() {
  return db.collection('codes').get().then(function(snap){ return snap.docs.map(function(d){ return Object.assign({id:d.id},d.data()); }); });
}


function voegCodeToe(code) {
  return db.collection('codes').doc(code).set({code:code,gebruikt:false,gebruiker:null});
}
function verwijderCodeFirestore(id) {
  return db.collection('codes').doc(id).delete();
}


function setThema(thema) {
  document.body.classList.toggle('licht-thema', thema==='licht');
  localStorage.setItem('thema', thema);
  document.getElementById('thema-donker').classList.toggle('actief', thema==='donker');
  document.getElementById('thema-licht').classList.toggle('actief', thema==='licht');
}

function laadThema() {
  var thema = localStorage.getItem('thema') || 'donker';
  setThema(thema);
}

/* ===== SCREENSHOT SCAN ===== */
var scanData = null;

function initScan() {
  var scanBtn = document.getElementById('scan-btn');
  var scanSectie = document.getElementById('scan-sectie');
  var dropzone = document.getElementById('scan-dropzone');
  var input = document.getElementById('scan-input');

  scanBtn.addEventListener('click', function() {
    var open = scanSectie.style.display === 'none';
    scanSectie.style.display = open ? 'block' : 'none';
    scanBtn.style.color = open ? 'var(--accent)' : '';
    scanBtn.style.borderColor = open ? 'var(--accent2)' : '';
    if (!open) { resetScan(); }
  });

  dropzone.addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){ if(input.files[0]) verwerkAfbeelding(input.files[0]); });

  dropzone.addEventListener('dragover', function(e){ e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', function(){ dropzone.classList.remove('drag'); });
  dropzone.addEventListener('drop', function(e){
    e.preventDefault(); dropzone.classList.remove('drag');
    if (e.dataTransfer.files[0]) verwerkAfbeelding(e.dataTransfer.files[0]);
  });

  document.getElementById('scan-verwerk-btn').addEventListener('click', function() {
    if (!scanData) return;
    var datum = scanData.datum;
    var tijd = scanData.tijd;
    var naam = scanData.naam || '';
    // Sluit scan sectie eerst
    resetScan();
    document.getElementById('scan-sectie').style.display = 'none';
    document.getElementById('scan-btn').style.color = '';
    document.getElementById('scan-btn').style.borderColor = '';
    // Vul velden in na reset
    document.getElementById('datum').value = datum;
    document.getElementById('starttijd').value = tijd;
    if (naam) document.getElementById('naam').value = naam;
    // Wacht tot DOM is bijgewerkt, dan voeg boeking toe
    setTimeout(function() {
      anker = strNaarDatum(datum);
      setView('dag');
      voegBoekingToe();
      // Zorg dat scan sectie volledig gesloten is
      resetScan();
      document.getElementById('scan-sectie').style.display = 'none';
      document.getElementById('scan-btn').style.color = '';
      document.getElementById('scan-btn').style.borderColor = '';
      document.getElementById('scan-preview').src = '';
    }, 100);
  });
}

function resetScan() {
  scanData = null;
  var preview = document.getElementById('scan-preview');
  preview.style.display = 'none';
  preview.src = '';
  document.getElementById('scan-placeholder').style.display = 'flex';
  document.getElementById('scan-placeholder').style.flexDirection = 'column';
  document.getElementById('scan-status').textContent = '';
  document.getElementById('scan-resultaat').style.display = 'none';
  document.getElementById('scan-verwerk-btn').style.display = 'none';
  document.getElementById('scan-input').value = '';
}

function verwerkAfbeelding(file) {
  var status = document.getElementById('scan-status');
  var resultaat = document.getElementById('scan-resultaat');
  var preview = document.getElementById('scan-preview');
  var placeholder = document.getElementById('scan-placeholder');
  var verwerk = document.getElementById('scan-verwerk-btn');

  status.textContent = 'Afbeelding wordt geladen...';
  resultaat.style.display = 'none';
  verwerk.style.display = 'none';
  scanData = null;

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    var mediaType = file.type || 'image/jpeg';

    preview.src = e.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    status.innerHTML = '<span class="loader"></span> Afbeelding wordt uitgelezen...';

    laadExtraScript('ocr', 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', function() { return window.Tesseract; })
    .then(function(ocr) { return ocr.recognize(e.target.result, 'nld+eng', { logger: function(){} }); })
    .then(function(result) {
      var tekst = result.data.text;
      var huidigJaar = new Date().getFullYear();
      var datum = null, tijd = null;

      // DD/MM/YYYY of DD-MM-YYYY of DD.MM.YYYY
      var m = tekst.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
      if (m) datum = m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');

      // DD/MM zonder jaar
      if (!datum) {
        m = tekst.match(/(\d{1,2})[\/\-](\d{2})(?!\d)/);
        if (m) datum = huidigJaar+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
      }

      // Uitgeschreven datum: "2 april" of "donderdag 2 april 2026"
      if (!datum) {
        var mn = {januari:1,februari:2,maart:3,april:4,mei:5,juni:6,juli:7,augustus:8,september:9,oktober:10,november:11,december:12,jan:1,feb:2,mrt:3,apr:4,jun:6,jul:7,aug:8,sep:9,okt:10,nov:11,dec:12};
        m = tekst.toLowerCase().match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|apr|jun|jul|aug|sep|okt|nov|dec)(?:\s+(\d{4}))?/);
        if (m && mn[m[2]]) datum = (m[3]?m[3]:huidigJaar)+'-'+String(mn[m[2]]).padStart(2,'0')+'-'+m[1].padStart(2,'0');
      }

      // Tijd HH:MM
      m = tekst.match(/(\d{1,2}):(\d{2})/);
      if (m) tijd = m[1].padStart(2,'0')+':'+m[2];

      // Naam: langste niet-numerieke regel
      // Naam wordt NIET gescand - wordt automatisch ingevuld als boekingnummer

      if (!datum && !tijd) {
        status.textContent = '❌ Geen datum of tijd gevonden. Probeer een duidelijkere foto.';
        status.style.color = 'var(--error)'; return;
      }

      scanData = {datum: datum||datumNaarStr(new Date()), tijd: tijd||'09:00', naam: ''};
      var mnd = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
      var d = new Date(scanData.datum);
      var datumLeesbaar = isNaN(d)?scanData.datum:d.getDate()+' '+mnd[d.getMonth()]+' '+d.getFullYear();
      resultaat.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Datum</span><strong style="color:var(--text);">'+datumLeesbaar+'</strong></div>' +
        '<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Tijd</span><strong style="color:var(--accent);">'+scanData.tijd+'</strong></div>' +
        '</div>';
      resultaat.style.display = 'block';
      verwerk.style.display = 'block';
      status.textContent = '✓ Gegevens gevonden!';
      status.style.color = 'var(--success)';
      // Vul datum en starttijd direct in de formuliervelden
      document.getElementById('datum').value = scanData.datum;
      document.getElementById('starttijd').value = scanData.tijd;
      anker = strNaarDatum(scanData.datum);
      setView('dag');
    })
    .catch(function() {
      status.textContent = '❌ Kon afbeelding niet lezen. Probeer een duidelijkere foto.';
      status.style.color = 'var(--error)';
    });
  };
  reader.readAsDataURL(file);
}

function updateRulesCard() {
  var h = Math.floor(MIN_GAP/60), m = MIN_GAP%60;
  document.getElementById('rules-gap').textContent = (h>0?h+'u ':'')+m+'m';
  document.getElementById('rules-open').textContent = minNaarTijd(OPEN);
  document.getElementById('rules-sluit').textContent = minNaarTijd(SLUIT);
}

// Paginanavigatie
var menuOpener = null;
function zetMenuOpen(open, herstelFocus) {
  document.getElementById('menu-bar').classList.toggle('open', open);
  document.querySelectorAll('.hamburger-btn').forEach(function(knop) {
    knop.classList.toggle('open', open);
    knop.setAttribute('aria-expanded', String(open));
  });
  if (!open && herstelFocus && menuOpener && menuOpener.offsetParent !== null) menuOpener.focus();
}
function toonPagina(pagina) {
  sessionStorage.setItem('huidigePagina', pagina);
  document.getElementById('app').style.display = pagina==='schema' ? 'block' : 'none';
  document.getElementById('admin-overlay').style.display = pagina==='admin' ? 'block' : 'none';
  document.getElementById('pagina-profiel').style.display = pagina==='profiel' ? 'block' : 'none';
  document.getElementById('pagina-instellingen').style.display = pagina==='instellingen' ? 'block' : 'none';
  document.getElementById('pagina-statistieken').style.display = pagina==='statistieken' ? 'block' : 'none';
  document.getElementById('pagina-pathe').style.display = pagina==='pathe' ? 'block' : 'none';
  document.getElementById('pagina-beheer').style.display = pagina==='beheer' ? 'block' : 'none';
  document.getElementById('pagina-ranglijst').style.display = pagina==='ranglijst' ? 'block' : 'none';
  document.getElementById('pagina-nieuws').style.display = pagina==='nieuws' ? 'block' : 'none';
  document.getElementById('pagina-abonnement').style.display = pagina==='abonnement' ? 'block' : 'none';
  abonnementBeheerOpen = pagina === 'abonnement';
  zetMenuOpen(false);
  window.scrollTo({top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
}

function renderProfielAvatar(foto, initiaal) {
  foto = veiligeFoto(foto);
  var el = document.getElementById('profiel-avatar');
  if (foto) {
    el.innerHTML = '<img src="'+foto+'" style="width:64px;height:64px;border-radius:50%;object-fit:cover;" />';
  } else {
    el.textContent = initiaal;
  }
}

function profielLidSinds(value) {
  if (!value) return 'Onbekend';
  var date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  var nederlands = typeof value === 'string' && /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[\s,T]|$)/.exec(value);
  if (nederlands) date = new Date(Number(nederlands[3]), Number(nederlands[2]) - 1, Number(nederlands[1]), 12);
  return isNaN(date.getTime()) ? 'Onbekend' : date.toLocaleDateString('nl-NL', {day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Amsterdam'});
}

function openProfiel() {
  var generatie = authGeneratie;
  renderProfielAvatar(null, huidigeGebruiker.charAt(0).toUpperCase());
  document.getElementById('profiel-naam').textContent = huidigeGebruiker;
  document.getElementById('profiel-email').textContent = '...';
  document.getElementById('profiel-datum').textContent = '...';
  toonPagina('profiel');
  function toonProfiel(account) {
    if (generatie !== authGeneratie) return;
    document.getElementById('profiel-email').textContent = account ? account.email : '-';
    document.getElementById('profiel-datum').textContent = profielLidSinds(account && account.aangemaakt);
    renderProfielAvatar(account && account.foto ? account.foto : null, huidigeGebruiker.charAt(0).toUpperCase());
  }
  if (authAccount) toonProfiel(authAccount);
  getAccount(huidigeGebruiker).then(function(account) {
    if (generatie !== authGeneratie) return;
    authAccount = account; toonProfiel(account);
  }).catch(function() { if (generatie === authGeneratie && !authAccount) document.getElementById('profiel-email').textContent = 'Tijdelijk niet beschikbaar'; });
}

function verwerkFoto(input) {
  if (!input.files || !input.files[0]) return;
  var generatie = authGeneratie;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      if (generatie !== authGeneratie) return;
      var canvas = document.createElement('canvas');
      canvas.width = 120; canvas.height = 120;
      var ctx = canvas.getContext('2d');
      // Bijsnijden tot vierkant
      var size = Math.min(img.width, img.height);
      var sx = (img.width - size) / 2, sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 120, 120);
      var base64 = canvas.toDataURL('image/jpeg', 0.8);
      renderProfielAvatar(base64, huidigeGebruiker.charAt(0).toUpperCase());
      db.collection('accounts').doc(huidigeGebruiker).update({foto: base64})
        .catch(function(e){ console.error('Foto opslaan mislukt:', e); });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function leesTijdvakAantal() {
  var invoer = document.getElementById('inst-max-tijdvakken');
  var n = invoer.valueAsNumber;
  var fout = document.getElementById('inst-tijdvakken-error');
  var melding = n > 4 ? 'Je kunt maximaal 4 tijdvakken instellen.' :
    (!Number.isInteger(n) || n < 1 ? 'Vul een heel getal van 1 tot en met 4 in.' : '');
  fout.textContent = melding;
  fout.hidden = !melding;
  invoer.setAttribute('aria-invalid', String(!!melding));
  return melding ? null : n;
}

function updateTijdvakNamenInputs() {
  var invoer = document.getElementById('inst-max-tijdvakken');
  // Replacing a number involves a temporary empty field. Do not insert 1
  // while the user is still typing, which turned the next digit into 12/4.
  if (invoer.value === '') {
    document.getElementById('inst-tijdvakken-error').hidden = true;
    invoer.removeAttribute('aria-invalid');
    return;
  }
  var n = leesTijdvakAantal();
  if (n === null) return;
  var container = document.getElementById('inst-tijdvak-namen');
  var html = '<div style="font-size:0.65rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Namen voor tijdvakken</div>';
  for (var i = 0; i < n; i++) {
    var invoer = document.getElementById('inst-tijdvak-naam-' + i);
    var huidigNaam = invoer ? invoer.value : (TIJDVAK_NAMEN[i] || ('Tijdvak ' + (i+1)));
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
    html += '<span style="font-size:0.72rem;color:var(--muted);min-width:70px;">Tijdvak ' + (i+1) + '</span>';
    html += '<input type="text" id="inst-tijdvak-naam-' + i + '" placeholder="Tijdvak ' + (i+1) + '" value="' + escHtml(huidigNaam) + '" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:\'DM Mono\',monospace;font-size:0.82rem;padding:7px 10px;outline:none;" />';
    if (i > 0) {
      html += '<button onclick="verwijderTijdvakRij(' + i + ')" title="Verwijder tijdvak" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;font-size:1rem;padding:4px 9px;line-height:1;transition:color 0.15s,border-color 0.15s;" onmouseover="this.style.color=\'var(--error)\';this.style.borderColor=\'var(--error)\'" onmouseout="this.style.color=\'var(--muted)\';this.style.borderColor=\'var(--border)\'">&times;</button>';
    }
    html += '</div>';
  }
  container.innerHTML = html;

}

function controleerTijdvakAantal(n) {
  if (boekingen.some(function(b) { return (b.tijdvak || 0) >= n; })) {
    alert('Verplaats eerst de boekingen uit de tijdvakken die je wilt verwijderen.');
    return false;
  }
  return true;
}

function verwijderTijdvakRij(idx) {
  if (!controleerTijdvakAantal(idx)) return;
  var n = leesTijdvakAantal();
  if (n === null) return;
  var namen = [];
  for (var i = 0; i < n; i++) {
    var el = document.getElementById('inst-tijdvak-naam-' + i);
    namen.push(el ? (el.value.trim() || ('Tijdvak ' + (i+1))) : ('Tijdvak ' + (i+1)));
  }
  namen.splice(idx, 1);
  var nieuwN = Math.max(1, n - 1);
  document.getElementById('inst-max-tijdvakken').value = nieuwN;
  updateTijdvakNamenInputs();
  for (var j = 0; j < namen.length; j++) {
    var el2 = document.getElementById('inst-tijdvak-naam-' + j);
    if (el2) el2.value = namen[j];
  }
}

function slaAlleenTijdvakkenOp() {
  var n = leesTijdvakAantal();
  if (n === null) { document.getElementById('inst-max-tijdvakken').focus(); return; }
  if (!controleerTijdvakAantal(n)) return;
  var namen = [];
  for (var i = 0; i < n; i++) {
    var el = document.getElementById('inst-tijdvak-naam-' + i);
    namen.push(el ? (el.value.trim() || ('Tijdvak ' + (i+1))) : ('Tijdvak ' + (i+1)));
  }
  db.collection('instellingen').doc(huidigeGebruiker).set({
    maxTijdvakken: n, tijdvakNamen: namen
  }, {merge:true}).then(function() {
    MAX_TIJDVAKKEN = n;
    TIJDVAK_NAMEN = namen;
    syncTijdvakFormSelect();
    updateTijdvakNamenInputs();
    renderOverzicht();
    voegLogToe('Tijdvakken opgeslagen.', 'success');
  }).catch(function(e) { alert('Fout: ' + e.message); });
}

function openInstellingen() {
  var gapUur = Math.floor(MIN_GAP/60);
  var gapMin = MIN_GAP%60;
  document.getElementById('inst-gap-uur').value = gapUur;
  document.getElementById('inst-gap-min').value = gapMin;
  document.getElementById('inst-open').value = minNaarTijd(OPEN);
  document.getElementById('inst-sluit').value = minNaarTijd(SLUIT);
  document.getElementById('inst-prijs').value = STANDAARD_PRIJS;
  document.getElementById('inst-max-tijdvakken').value = MAX_TIJDVAKKEN;
  document.getElementById('inst-tijdvak-namen').innerHTML = '';
  updateTijdvakNamenInputs();
  // Meldingsinstellingen
  document.getElementById('inst-melding-richting').value = MELDING_RICHTING;
  document.getElementById('inst-melding-minuten').value = MELDING_MINUTEN;
  document.getElementById('toggle-push-nieuws').classList.toggle('aan', PUSH_NIEUWS);
  document.getElementById('toggle-push-achteraf').classList.toggle('aan', PUSH_ACHTERAF);
  // Laad ranglijst zichtbaarheid
  getAccount(huidigeGebruiker).then(function(account) {
    var isPrive = account && account.ranglijstPrive;
    document.getElementById('rang-openbaar').classList.toggle('actief', !isPrive);
    document.getElementById('rang-prive').classList.toggle('actief', !!isPrive);
  });
  toonPagina('instellingen');
}

function setRanglijstZichtbaarheid(isPrive) {
  document.getElementById('rang-openbaar').classList.toggle('actief', !isPrive);
  document.getElementById('rang-prive').classList.toggle('actief', isPrive);
  db.collection('accounts').doc(huidigeGebruiker).update({ranglijstPrive: isPrive}).catch(function(e){ console.error(e); });
}

var MIN_GAP = 95, DUUR = 95, OPEN = 540, SLUIT = 1440, STANDAARD_PRIJS = 10;
var MAX_TIJDVAKKEN = 1;
var TIJDVAK_NAMEN = ['Tijdvak 1'];
var DAGEN = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
var DAGEN_KORT = ['zo','ma','di','wo','do','vr','za'];
var MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

// State - allemaal var zodat er nooit een lexical conflict is
var huidigView = 'week';
var anker = new Date();
var logItems = [];
var boekingen = [];
var undoStack = [];
var huidigeGebruiker = '';
var authModus = 'login';

// Hulpfuncties
function datumNaarStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function strNaarDatum(s) {
  var p = s.split('-').map(Number);
  return new Date(p[0], p[1]-1, p[2]);
}
function tijdNaarMin(t) {
  var p = t.split(':').map(Number);
  return p[0]*60 + p[1];
}
function minNaarTijd(min) {
  var h = Math.floor(min/60) % 24, m = min % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function nuTijdStr() {
  var n = new Date();
  return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0') + ':' + String(n.getSeconds()).padStart(2,'0');
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function isVandaag(ds) { return ds === datumNaarStr(new Date()); }
function boekVoorDag(ds) {
  return boekingen.filter(function(b){ return b.datumStr === ds; }).sort(function(a,b){ return a.start - b.start; });
}


var boekingOpslaanBezig = false;

// Herstel de vorige toestand als Firestore de wijziging niet kan bewaren.
function bewaarBoekingWijziging(wijziging, naOpslaan, isUndo) {
  if (boekingOpslaanBezig) return Promise.resolve(false);
  var generatie = authGeneratie;
  var opslagGebruiker = huidigeGebruiker;
  var vorigeBoekingen = JSON.stringify(boekingen);
  var vorigeUndo = undoStack.slice();
  boekingOpslaanBezig = true;
  var knoppen = Array.from(document.querySelectorAll('#add-btn, #bewerk-opslaan-btn, #clear-btn, #undo-btn'));
  var vorigeDisabled = knoppen.map(function(btn) { return btn.disabled; });
  knoppen.forEach(function(btn) { btn.disabled = true; });
  if (!isUndo) slaSnapshot();
  wijziging();
  boekingen.forEach(function(b) {
    if (!b._documentId) b._documentId = db.collection('boekingen').doc().id;
  });
  var opslagLijst = JSON.parse(JSON.stringify(boekingen));
  return Promise.resolve().then(function() {
    if (generatie !== authGeneratie) return;
    return slaOp(opslagGebruiker, opslagLijst, JSON.parse(vorigeBoekingen));
  }).then(function() {
    if (generatie !== authGeneratie || opslagGebruiker !== huidigeGebruiker) return false;
    if (naOpslaan) naOpslaan();
    return true;
  }, function(error) {
    if (generatie !== authGeneratie || opslagGebruiker !== huidigeGebruiker) return false;
    boekingen = JSON.parse(vorigeBoekingen);
    undoStack = vorigeUndo;
    var melding = 'Niet opgeslagen. Controleer je verbinding en probeer opnieuw.';
    if (error && error.code === 'permission-denied') melding = 'Niet opgeslagen: de database weigert deze wijziging (permission-denied).';
    else if (error && error.code === 'unauthenticated') melding = 'Niet opgeslagen: log opnieuw in en probeer nogmaals.';
    else if (error && error.code === 'aborted') melding = 'Niet opgeslagen: deze boeking is inmiddels gewijzigd. Vernieuw de pagina en probeer opnieuw.';
    else if (error && error.code === 'resource-exhausted') melding = 'Niet opgeslagen: te veel wijzigingen tegelijk. Probeer een kleinere selectie.';
    else if (error && error.code === 'invalid-argument') melding = 'Niet opgeslagen: controleer de datum, tijd en prijs van de boeking.';
    voegLogToe(melding, 'error');
    var fout = document.getElementById('bewerk-error');
    if (document.getElementById('bewerk-overlay').style.display === 'flex') {
      fout.textContent = melding;
      fout.style.display = 'block';
    }
    renderOverzicht();
    return false;
  }).finally(function() {
    if (generatie !== authGeneratie || opslagGebruiker !== huidigeGebruiker) return;
    boekingOpslaanBezig = false;
    knoppen.forEach(function(btn, i) { btn.disabled = vorigeDisabled[i]; });
    updateUndoBtn();
  });
}

function leesPrijs(waarde, standaard) {
  if (waarde == null || String(waarde).trim() === '') return standaard;
  var prijs = Number(waarde);
  return Number.isFinite(prijs) && prijs >= 0 ? prijs : NaN;
}

// Undo
function slaSnapshot() {
  undoStack.push(JSON.stringify(boekingen));
  if (undoStack.length > 20) undoStack.shift();
  updateUndoBtn();
}
function updateUndoBtn() {
  var btn = document.getElementById('undo-btn');
  if (btn) btn.disabled = boekingOpslaanBezig || undoStack.length === 0;
}
function ongedaanMaken() {
  if (boekingOpslaanBezig || !undoStack.length) return;
  return bewaarBoekingWijziging(function() {
      boekingen = JSON.parse(undoStack.pop());
  }, function() {
    voegLogToe('Laatste actie ongedaan gemaakt.', 'success');
    renderOverzicht();
  }, true);
}

// Auth meldingen
function toonAuthFout(msg) {
  var el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}
function toonAuthSuccess(msg) {
  var el = document.getElementById('auth-success');
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}

function toonApp(user) {
  if (!authProfiel || authProfiel.gebruiker !== user || !auth || !auth.currentUser ||
      authProfiel.uid !== auth.currentUser.uid || !auth.currentUser.emailVerified ||
      (abonnementStatus && !abonnementStatus.allowed)) {
    return Promise.reject(new Error('Niet ingelogd.'));
  }
  var generatie = authGeneratie;
  resetPlanningVoorbeeld();
  huidigeGebruiker = user;
  document.getElementById('menu-beheer').style.display = isBeheerder() ? '' : 'none';
  // The member ranking uses a filtered server response, never private records.
  document.getElementById('menu-ranglijst').style.display = '';
  return Promise.all([laadBoekingen(), laadInstellingen()]).then(function() {
    if (generatie !== authGeneratie || !authProfiel || authProfiel.gebruiker !== user ||
        huidigeGebruiker !== user || (abonnementStatus && !abonnementStatus.allowed)) return;
    undoStack = [];
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('datum').value = datumNaarStr(new Date());
    startMeldingTimer();
    checkNieuweUpdates();
    // Abonneer op push notificaties (vraagt toestemming indien nodig)
    setTimeout(abonneerOpPush, 2000);
    // Herstel vorige pagina na refresh, of navigeer via ?goto= (vanuit push-notificatie)
    var gotoParam = new URLSearchParams(window.location.search).get('goto');
    var herstelpagina = sessionStorage.getItem('huidigePagina') || 'schema';
    if (gotoParam === 'nieuws' || gotoParam === 'meldingen') { openNieuwsPagina(); }
    else if (herstelpagina === 'profiel') { openProfiel(); }
    else if (herstelpagina === 'abonnement') { openAbonnementOverzicht(); }
    else if (herstelpagina === 'instellingen') { openInstellingen(); }
    else if (herstelpagina === 'statistieken') { toonPagina('statistieken'); renderStatistieken(); }
    else if (herstelpagina === 'pathe') { openPathe(); }
    else if (herstelpagina === 'admin' && authRechten.admin === true) { openAdminPaneel(); }
    else if (herstelpagina === 'beheer' && isBeheerder()) { openBeheerPagina(); }
    else if (herstelpagina === 'ranglijst') { openRanglijst(); }
    else if (herstelpagina === 'nieuws') { openNieuwsPagina(); }
    else { toonPagina('schema'); renderOverzicht(); }
    verbergSessieLaden();
  });
}


// Log
function voegLogToe(tekst, type) {
  logItems.unshift({tekst: tekst, type: type, tijd: nuTijdStr()});
  renderLog();
}
function renderLog() {
  var c = document.getElementById('logboek');
  if (!logItems.length) { c.innerHTML = '<div class="log-empty">Nog geen meldingen</div>'; return; }
  c.innerHTML = logItems.map(function(i) {
    return '<div class="log-item ' + i.type + '"><span>' + (i.type==='error'?'x':'v') + '</span><span>' + escHtml(i.tekst) + '</span><span class="log-time">' + i.tijd + '</span></div>';
  }).join('');
}

// Hulpfunctie: boekingen voor dag in specifiek tijdvak
function boekVoorDagInTijdvak(ds, tijdvak) {
  return boekingen.filter(function(b) {
    return b.datumStr === ds && (b.tijdvak || 0) === tijdvak;
  }).sort(function(a,b){ return a.start - b.start; });
}

// Boekingen
function voegBoekingToe() {
  if (boekingOpslaanBezig) return;
  pendingBoeking = null;
  var oudPanel = document.getElementById('tijdvak-conflict-panel');
  if (oudPanel) oudPanel.remove();
  var naam = document.getElementById('naam').value.trim();
  var datumStr = document.getElementById('datum').value;
  var tijdStr = document.getElementById('starttijd').value;
  if (!datumStr) { voegLogToe('Kies een datum.', 'error'); return; }
  if (!tijdStr) { voegLogToe('Vul een starttijd in.', 'error'); return; }
  var start = tijdNaarMin(tijdStr);
  if (start < OPEN) { voegLogToe('Starttijd mag niet voor ' + minNaarTijd(OPEN) + ' zijn.', 'error'); return; }
  if (start >= SLUIT) { voegLogToe('Starttijd mag niet om of na ' + minNaarTijd(SLUIT) + ' zijn.', 'error'); return; }
  var eind = start + DUUR;
  if (!naam) { naam = 'Boeking ' + (boekVoorDag(datumStr).length + 1); }

  var betaling = (document.querySelector('.toggle-opt.active[data-groep="betaling"]') || {getAttribute: function(){ return null; }}).getAttribute('data-waarde') || 'betaald';
  var platform = document.getElementById('platform-select').value || '';
  var prijs = leesPrijs(document.getElementById('prijs-input').value, 10);

  if (!Number.isFinite(prijs)) { voegLogToe('Vul een geldige prijs in (minimaal 0).', 'error'); return; }

  // Lees gewenst tijdvak uit de form selector (alleen bij meerdere tijdvakken)
  var gewenstTijdvak = 0;
  if (MAX_TIJDVAKKEN > 1) {
    var tvSel = document.getElementById('tijdvak-select');
    if (tvSel) gewenstTijdvak = parseInt(tvSel.value) || 0;
    if (gewenstTijdvak < 0 || gewenstTijdvak >= MAX_TIJDVAKKEN) { voegLogToe('Kies een geldig tijdvak.', 'error'); return; }
  }

  // Bepaal welke tijdvakken bezet zijn
  var bezetteTijdvakken = [];
  for (var tv = 0; tv < MAX_TIJDVAKKEN; tv++) {
    var tvBoek = boekVoorDagInTijdvak(datumStr, tv);
    for (var j = 0; j < tvBoek.length; j++) {
      if (Math.abs(start - tvBoek[j].start) < MIN_GAP) {
        bezetteTijdvakken.push(tv);
        break;
      }
    }
  }

  // Alle tijdvakken bezet → foutmelding
  if (bezetteTijdvakken.length >= MAX_TIJDVAKKEN) {
    var dagBoek0 = boekVoorDagInTijdvak(datumStr, 0);
    var conflictB = null;
    for (var ci = 0; ci < dagBoek0.length; ci++) {
      if (Math.abs(start - dagBoek0[ci].start) < MIN_GAP) { conflictB = dagBoek0[ci]; break; }
    }
    var msg = 'Niet mogelijk - alle tijdvakken zijn bezet op dit tijdstip.';
    if (conflictB) {
      var vn = conflictB.start + MIN_GAP, lv = conflictB.start - MIN_GAP;
      msg += lv >= OPEN ? ' Laatste slot ervoor: ' + minNaarTijd(lv) + '.' : '';
      msg += vn < SLUIT ? ' Vroegste slot erna: ' + minNaarTijd(vn) + '.' : '';
    }
    voegLogToe(msg, 'error'); return;
  }

  // Gewenst tijdvak vrij → direct toevoegen in dat tijdvak
  if (bezetteTijdvakken.indexOf(gewenstTijdvak) === -1) {
    return bewaarBoekingWijziging(function() {
      boekingen.push({datumStr: datumStr, naam: naam, start: start, eind: eind, betaling: betaling, platform: platform, prijs: prijs, tijdvak: gewenstTijdvak});
    }, function() {
      document.getElementById('naam').value = '';
      document.getElementById('platform-select').value = '';
      document.getElementById('prijs-input').value = STANDAARD_PRIJS;
      // Reset scan als die open was
      if (document.getElementById('scan-sectie').style.display !== 'none' || scanData) {
        resetScan();
        document.getElementById('scan-preview').src = '';
        document.getElementById('scan-sectie').style.display = 'none';
        document.getElementById('scan-btn').style.color = '';
        document.getElementById('scan-btn').style.borderColor = '';
      }
      voegLogToe('Boeking "' + naam + '" op ' + datumStr + ' om ' + tijdStr + '-' + minNaarTijd(eind) + ' toegevoegd.', 'success');
      renderOverzicht();
    });
  }

  // Gewenst tijdvak bezet maar andere zijn vrij → toon keuze UI
  if (MAX_TIJDVAKKEN > 1) {
    pendingBoeking = {datumStr: datumStr, naam: naam, start: start, eind: eind, betaling: betaling, platform: platform, prijs: prijs, tijdStr: tijdStr};
    var vrijeTijdvakken = [];
    for (var fv = 0; fv < MAX_TIJDVAKKEN; fv++) {
      if (bezetteTijdvakken.indexOf(fv) === -1) vrijeTijdvakken.push(fv);
    }
    var tv0naam = TIJDVAK_NAMEN[gewenstTijdvak] || ('Tijdvak ' + (gewenstTijdvak+1));
    var msgHtml = 'Tijdvak "' + escHtml(tv0naam) + '" is bezet. Kies een ander tijdvak:';
    var knoppen = vrijeTijdvakken.map(function(ti) {
      return '<button onclick="voegBoekingToeInTijdvak(' + ti + ')" style="background:rgba(232,201,122,0.12);border:1px solid var(--accent2);border-radius:6px;color:var(--accent);cursor:pointer;font-family:\'DM Mono\',monospace;font-size:0.72rem;padding:6px 14px;margin:4px;transition:all 0.15s;" onmouseover="this.style.background=\'rgba(232,201,122,0.22)\'" onmouseout="this.style.background=\'rgba(232,201,122,0.12)\'">' + escHtml(TIJDVAK_NAMEN[ti] || ('Tijdvak ' + (ti+1))) + '</button>';
    }).join('');
    var conflictPanel = '<div id="tijdvak-conflict-panel" style="background:rgba(232,201,122,0.06);border:1px solid var(--accent2);border-radius:8px;padding:12px 14px;margin-top:10px;">' +
      '<div style="font-size:0.75rem;color:var(--text);margin-bottom:8px;">' + msgHtml + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">' + knoppen +
      '<button onclick="document.getElementById(\'tijdvak-conflict-panel\').style.display=\'none\';pendingBoeking=null;" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;font-family:\'DM Mono\',monospace;font-size:0.68rem;padding:6px 10px;margin:4px;">Annuleren</button>' +
      '</div></div>';
    // Verwijder eventueel oud panel
    var oud = document.getElementById('tijdvak-conflict-panel');
    if (oud) oud.remove();
    var logboek = document.getElementById('logboek');
    logboek.insertAdjacentHTML('beforebegin', conflictPanel);
    voegLogToe('Tijdvak "' + tv0naam + '" is bezet op ' + tijdStr + '. Kies een vrij tijdvak hierboven.', 'error');
  }
}

function voegBoekingToeInTijdvak(tijdvakIndex) {
  if (boekingOpslaanBezig) return;
  if (!pendingBoeking) return;
  var b = pendingBoeking;
  if (!Number.isInteger(tijdvakIndex) || tijdvakIndex < 0 || tijdvakIndex >= MAX_TIJDVAKKEN ||
      b.start < OPEN || b.start >= SLUIT || boekVoorDagInTijdvak(b.datumStr, tijdvakIndex).some(function(boeking) {
        return Math.abs(b.start - boeking.start) < MIN_GAP;
      })) {
    voegLogToe('Dit tijdvak is inmiddels bezet of niet meer beschikbaar. Kies opnieuw.', 'error');
    pendingBoeking = null;
    var oudPanel = document.getElementById('tijdvak-conflict-panel');
    if (oudPanel) oudPanel.remove();
    return;
  }
  b.eind = b.start + DUUR;
  pendingBoeking = null;
  var panel = document.getElementById('tijdvak-conflict-panel');
  if (panel) panel.remove();
  return bewaarBoekingWijziging(function() {
    boekingen.push({datumStr: b.datumStr, naam: b.naam, start: b.start, eind: b.eind, betaling: b.betaling, platform: b.platform, prijs: b.prijs, tijdvak: tijdvakIndex});
  }, function() {
    document.getElementById('naam').value = '';
    document.getElementById('platform-select').value = '';
    document.getElementById('prijs-input').value = STANDAARD_PRIJS;
    var tijdvaknaam = TIJDVAK_NAMEN[tijdvakIndex] || ('Tijdvak ' + (tijdvakIndex+1));
    voegLogToe('Boeking "' + b.naam + '" op ' + b.datumStr + ' om ' + b.tijdStr + '-' + minNaarTijd(b.eind) + ' toegevoegd in ' + tijdvaknaam + '.', 'success');
    renderOverzicht();
  });
}

var pendingBoeking = null;
var bewerkDatumStr = null, bewerkStart = null, bewerkTijdvak = 0;

function openBewerkModal(datumStr, start, tijdvak) {
  tijdvak = tijdvak == null ? 0 : Number(tijdvak);
  var b = boekingen.find(function(b){ return b.datumStr===datumStr && b.start===start && (b.tijdvak == null ? 0 : b.tijdvak)===tijdvak; });
  if (!b) return;
  bewerkDatumStr = datumStr; bewerkStart = start; bewerkTijdvak = tijdvak;
  document.getElementById('bewerk-naam').value = b.naam || '';
  document.getElementById('bewerk-tijd').value = minNaarTijd(b.start);
  document.getElementById('bewerk-prijs').value = (b.prijs == null ? 10 : b.prijs);
  document.getElementById('bewerk-platform').value = b.platform || '';
  document.getElementById('bewerk-error').style.display = 'none';
  // Betaling toggle
  document.querySelectorAll('.toggle-opt[data-groep="bewerk-betaling"]').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-waarde') === b.betaling);
  });
  document.getElementById('bewerk-subtitle').textContent = b.naam || 'Boeking';
  // Tijdvak selector
  var tvContainer = document.getElementById('bewerk-tijdvak-groep');
  if (MAX_TIJDVAKKEN > 1) {
    var huidigTv = b.tijdvak || 0;
    var tvHtml = '<div class="toggle-groep" id="bewerk-tijdvak-toggle">';
    for (var ti = 0; ti < MAX_TIJDVAKKEN; ti++) {
      tvHtml += '<button class="toggle-opt' + (huidigTv === ti ? ' active' : '') + '" data-groep="bewerk-tijdvak" data-waarde="' + ti + '">' + escHtml(TIJDVAK_NAMEN[ti] || ('Tijdvak ' + (ti+1))) + '</button>';
    }
    tvHtml += '</div>';
    tvContainer.innerHTML = tvHtml;
    tvContainer.style.display = '';
    // Koppel click-events aan de nieuwe toggle-knoppen
    tvContainer.querySelectorAll('.toggle-opt[data-groep="bewerk-tijdvak"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        tvContainer.querySelectorAll('.toggle-opt[data-groep="bewerk-tijdvak"]').forEach(function(b){ b.classList.remove('active'); });
        this.classList.add('active');
      });
    });
  } else {
    tvContainer.style.display = 'none';
    tvContainer.innerHTML = '';
  }
  document.getElementById('bewerk-overlay').style.display = 'flex';
}

function slaBewerking() {
  if (boekingOpslaanBezig) return;
  var idx = boekingen.findIndex(function(b){ return b.datumStr===bewerkDatumStr && b.start===bewerkStart && (b.tijdvak == null ? 0 : b.tijdvak)===bewerkTijdvak; });
  if (idx===-1) return;
  var nieuweNaam = document.getElementById('bewerk-naam').value.trim();
  var nieuweTijd = document.getElementById('bewerk-tijd').value;
  var nieuwePrijs = leesPrijs(document.getElementById('bewerk-prijs').value, 10);
  var nieuwePlatform = document.getElementById('bewerk-platform').value;
  var nieuweBetaling = (document.querySelector('.toggle-opt.active[data-groep="bewerk-betaling"]') || {getAttribute: function(){ return null; }}).getAttribute('data-waarde') || 'betaald';
  var fout = document.getElementById('bewerk-error');
  if (!Number.isFinite(nieuwePrijs)) { fout.textContent='Vul een geldige prijs in (minimaal 0).'; fout.style.display='block'; return; }
  if (!nieuweTijd) { fout.textContent='Vul een starttijd in.'; fout.style.display='block'; return; }
  var nieuweStart = tijdNaarMin(nieuweTijd);
  if (nieuweStart < OPEN) { fout.textContent='Starttijd mag niet voor ' + minNaarTijd(OPEN) + '.'; fout.style.display='block'; return; }
  if (nieuweStart >= SLUIT) { fout.textContent='Starttijd mag niet om of na ' + minNaarTijd(SLUIT) + '.'; fout.style.display='block'; return; }
  // Bepaal nieuw tijdvak vóór de conflict check
  var nieuwTijdvak = boekingen[idx].tijdvak || 0;
  if (MAX_TIJDVAKKEN > 1) {
    var tvBtn = document.querySelector('.toggle-opt.active[data-groep="bewerk-tijdvak"]');
    if (tvBtn) nieuwTijdvak = parseInt(tvBtn.getAttribute('data-waarde')) || 0;
  }
  // Conflict check (skip zichzelf) — rekening houden met tijdvakken
  var dagBoekZelfdeTV = boekingen.filter(function(b,bi){ return b.datumStr===bewerkDatumStr && bi!==idx && (b.tijdvak||0)===nieuwTijdvak; });
  for (var ci2=0; ci2<dagBoekZelfdeTV.length; ci2++) {
    if (Math.abs(nieuweStart - dagBoekZelfdeTV[ci2].start) < MIN_GAP) {
      fout.textContent='Tijd conflicteert met een andere boeking in dit tijdvak.'; fout.style.display='block'; return;
    }
  }
  return bewaarBoekingWijziging(function() {
    boekingen[idx].naam = nieuweNaam || ('Boeking '+(idx+1));
    boekingen[idx].start = nieuweStart;
    boekingen[idx].eind = nieuweStart + DUUR;
    boekingen[idx].betaling = nieuweBetaling;
    boekingen[idx].prijs = nieuwePrijs;
    boekingen[idx].platform = nieuwePlatform;
    boekingen[idx].tijdvak = nieuwTijdvak;
  }, function() {
    document.getElementById('bewerk-overlay').style.display = 'none';
    voegLogToe('Boeking bijgewerkt.', 'success');
    renderOverzicht();
    if (document.getElementById('pagina-statistieken').style.display !== 'none') {
      renderStatistieken();
    }
    var lijst = document.getElementById('stat-openstaand-lijst');
    if (lijst) lijst.style.display = 'none';
  });
}

function markeerBetaald(datumStr, start, tijdvak) {
  if (boekingOpslaanBezig) return;
  tijdvak = tijdvak == null ? 0 : Number(tijdvak);
  var idx = boekingen.findIndex(function(b){ return b.datumStr===datumStr && b.start===start && (b.tijdvak == null ? 0 : b.tijdvak)===tijdvak; });
  if (idx===-1) return;
  return bewaarBoekingWijziging(function() {
    boekingen[idx].betaling = 'betaald';
  }, function() {
    voegLogToe('Boeking "' + boekingen[idx].naam + '" gemarkeerd als betaald.', 'success');
    renderOverzicht();
    if (document.getElementById('pagina-statistieken').style.display !== 'none') {
      renderStatistieken();
    }
    var lijst = document.getElementById('stat-openstaand-lijst');
    if (lijst) lijst.style.display = 'none';
  });
}

function verwijderBoeking(datumStr, start, tijdvak) {
  if (boekingOpslaanBezig) return;
  tijdvak = tijdvak == null ? 0 : Number(tijdvak);
  var idx = boekingen.findIndex(function(b){ return b.datumStr === datumStr && b.start === start && (b.tijdvak == null ? 0 : b.tijdvak)===tijdvak; });
  if (idx === -1) return;
  var b = boekingen[idx];
  return bewaarBoekingWijziging(function() {
    boekingen.splice(idx, 1);
  }, function() {
    voegLogToe('Boeking "' + b.naam + '" op ' + b.datumStr + ' (' + minNaarTijd(b.start) + ') verwijderd.', 'error');
    renderOverzicht();
  });
}

function allesLeegmaken() {
  if (boekingOpslaanBezig) return;
  var ds = datumNaarStr(anker);
  var aantal = boekingen.filter(function(b){ return b.datumStr === ds; }).length;
  return bewaarBoekingWijziging(function() {
    boekingen = boekingen.filter(function(b){ return b.datumStr !== ds; });
  }, function() {
    voegLogToe(aantal + ' boeking(en) op ' + ds + ' gewist.', 'error');
    renderOverzicht();
  });
}

// View & navigatie
function setView(v) {
  huidigView = v;
  ['dag','week','maand'].forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('active', t === v);
  });
  renderOverzicht();
}

function naarVandaag() {
  anker = new Date();
  document.getElementById('datum').value = datumNaarStr(anker);
  setView('dag');
}

function navigeer(dir) {
  if (huidigView === 'dag') {
    anker = new Date(anker); anker.setDate(anker.getDate() + dir);
    document.getElementById('datum').value = datumNaarStr(anker);
  } else if (huidigView === 'week') {
    anker = new Date(anker); anker.setDate(anker.getDate() + dir * 7);
  } else {
    anker = new Date(anker); anker.setMonth(anker.getMonth() + dir);
  }
  renderOverzicht();
}

function naarDag(ds) {
  anker = strNaarDatum(ds);
  document.getElementById('datum').value = ds;
  setView('dag');
}

// Hulpfunctie: render een lijst boekingen met slot-indicatoren (herbruikbaar per tijdvak)
function renderBoekingLijst(dagBoek, numOffset) {
  var html = '';
  dagBoek.forEach(function(b, i) {
    var prev = i > 0 ? dagBoek[i-1] : null;
    var next = i < dagBoek.length-1 ? dagBoek[i+1] : null;
    var lv = b.start - MIN_GAP, vv = b.start + MIN_GAP;
    var ruimteVoor = !prev ? (lv >= OPEN) : (b.start - prev.start >= MIN_GAP * 2);
    var ruimteNa = !next ? true : (next.start - b.start >= MIN_GAP * 2);
    if (ruimteVoor) {
      if (lv >= OPEN) html += '<div class="slot-indicator slot-prev"><span class="slot-label">Vorige uiterlijk</span><span class="slot-time-blue">' + minNaarTijd(lv) + '</span></div>';
      else html += '<div class="slot-indicator slot-prev"><span class="slot-label">Vorige uiterlijk</span><span class="slot-closed">Voor 09:00</span></div>';
    }
    var tvBadge = MAX_TIJDVAKKEN > 1 ? '<span style="font-size:0.6rem;background:rgba(138,180,212,0.15);color:var(--blue);border:1px solid rgba(138,180,212,0.3);border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:middle;">' + escHtml(TIJDVAK_NAMEN[b.tijdvak||0] || ('T'+(b.tijdvak||0)+1)) + '</span>' : '';
    html += '<div class="booking-item' + (b.betaling === 'achteraf' ? ' onbetaald' : '') + '"><div class="booking-left"><div class="booking-num">' + ((numOffset||0)+i+1) + '</div><div><div class="booking-name">' + escHtml(b.naam) + tvBadge + '</div><div class="booking-time">&#9201; ' + minNaarTijd(b.start) + ' - ' + minNaarTijd(b.eind) + '</div><div class="booking-dur">Duur: 1u 35m' + (b.platform ? ' &nbsp;&middot;&nbsp; ' + escHtml(b.platform) : '') + (b.betaling ? ' &nbsp;&middot;&nbsp; ' + escHtml(b.betaling) : '') + '</div></div></div><div style="display:flex;align-items:center;gap:4px;">' + (b.betaling === 'achteraf' ? '<button class="betaald-btn" onclick="markeerBetaald(\'' + b.datumStr + '\',' + b.start + ',' + (b.tijdvak||0) + ')" title="Markeer als betaald">Betaald</button>' : '') + '<button class="edit-btn" onclick="openBewerkModal(\'' + b.datumStr + '\',' + b.start + ',' + (b.tijdvak||0) + ')" title="Bewerk boeking">&#9998;</button><button class="delete-btn" onclick="verwijderBoeking(\'' + b.datumStr + '\',' + b.start + ',' + (b.tijdvak||0) + ')">&#10005;</button></div></div>';
    if (ruimteNa) {
      if (vv < SLUIT) html += '<div class="slot-indicator slot-next"><span class="slot-label">Volgende vanaf</span><span class="slot-time-gold">' + minNaarTijd(vv) + '</span></div>';
      else html += '<div class="slot-indicator slot-next"><span class="slot-label">Volgende vanaf</span><span class="slot-closed">Niet meer mogelijk vandaag (na 00:00)</span></div>';
    }
  });
  return html;
}

// Render dag
function renderDag(ds) {
  var d = strNaarDatum(ds);
  var dagNaam = DAGEN[d.getDay()];
  var isToday = isVandaag(ds);
  var dagBoek = boekVoorDag(ds);
  var html = '<div class="day-header' + (isToday ? ' today-label' : '') + '"><span>' + dagNaam.charAt(0).toUpperCase() + dagNaam.slice(1) + ' ' + d.getDate() + ' ' + MAANDEN[d.getMonth()] + ' ' + d.getFullYear() + (isToday ? ' - vandaag' : '') + '</span></div>';

  if (MAX_TIJDVAKKEN <= 1) {
    // Enkelvoudig weergave — origineel gedrag
    if (!dagBoek.length) {
      html += '<div class="empty-day">Geen boekingen op deze dag</div>';
    } else {
      html += renderBoekingLijst(dagBoek, 0);
    }
  } else {
    // Multi-tijdvak weergave — alleen kolommen met boekingen tonen (+ altijd tijdvak 0)
    var zichtbaar = [0];
    for (var tv2 = 1; tv2 < MAX_TIJDVAKKEN; tv2++) {
      if (boekVoorDagInTijdvak(ds, tv2).length > 0) zichtbaar.push(tv2);
    }
    html += '<div style="display:grid;grid-template-columns:repeat(' + zichtbaar.length + ',1fr);gap:8px;margin-bottom:8px;">';
    for (var ti = 0; ti < zichtbaar.length; ti++) {
      var naam = TIJDVAK_NAMEN[zichtbaar[ti]] || ('Tijdvak ' + (zichtbaar[ti]+1));
      html += '<div style="background:rgba(138,180,212,0.07);border:1px solid rgba(138,180,212,0.2);border-radius:6px;padding:6px 10px;text-align:center;font-size:0.65rem;color:var(--blue);letter-spacing:0.08em;text-transform:uppercase;">' + escHtml(naam) + '</div>';
    }
    html += '</div>';
    html += '<div class="tijdvak-kolom-grid" style="grid-template-columns:repeat(' + zichtbaar.length + ',1fr);">';
    for (var tj = 0; tj < zichtbaar.length; tj++) {
      var tvBoek = boekVoorDagInTijdvak(ds, zichtbaar[tj]);
      html += '<div class="tijdvak-kolom">';
      if (!tvBoek.length) {
        html += '<div class="empty-day" style="font-size:0.68rem;">Vrij</div>';
      } else {
        html += renderBoekingLijst(tvBoek, 0);
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

// Render week
function getMaandagVanWeek(d) {
  var dag = new Date(d), dow = dag.getDay();
  dag.setDate(dag.getDate() - (dow === 0 ? 6 : dow - 1));
  dag.setHours(0,0,0,0);
  return dag;
}

function renderWeek() {
  var ma = getMaandagVanWeek(anker);
  var zo = new Date(ma); zo.setDate(zo.getDate() + 6);
  document.getElementById('nav-label').textContent = ma.getDate() + ' ' + MAANDEN[ma.getMonth()].slice(0,3) + ' - ' + zo.getDate() + ' ' + MAANDEN[zo.getMonth()].slice(0,3) + ' ' + zo.getFullYear();
  var html = '<div class="week-grid-wrapper"><div class="week-grid">';
  for (var i = 0; i < 7; i++) {
    var dag = new Date(ma); dag.setDate(dag.getDate() + i);
    var ds = datumNaarStr(dag);
    var isToday = isVandaag(ds);
    var isPast = dag < new Date().setHours(0,0,0,0) && !isToday;
    var dagBoek = boekVoorDag(ds);
    var dagKort = DAGEN_KORT[dag.getDay()].toUpperCase();
    html += '<div class="week-col' + (isToday ? ' today-col' : '') + (isPast ? ' past-col' : '') + '" onclick="naarDag(\'' + ds + '\')" style="cursor:pointer;"><div class="week-col-header"><div>' + dagKort + '</div><div class="week-col-date">' + dag.getDate() + '</div></div><div class="week-bookings">';
    if (!dagBoek.length) {
      html += '<div class="week-empty">vrij</div>';
    } else {
      dagBoek.forEach(function(b) {
        var tvBadge = MAX_TIJDVAKKEN > 1 ? '<span style="font-size:0.55rem;background:rgba(138,180,212,0.18);color:var(--blue);border-radius:3px;padding:0 4px;margin-left:4px;vertical-align:middle;">' + escHtml(TIJDVAK_NAMEN[b.tijdvak||0] || ('T'+(((b.tijdvak||0)+1)))) + '</span>' : '';
        html += '<div class="week-booking-pill' + (b.betaling === 'achteraf' ? ' onbetaald' : '') + '"><div class="week-pill-name">' + escHtml(b.naam) + tvBadge + '</div><div class="week-pill-time">' + minNaarTijd(b.start) + '-' + minNaarTijd(b.eind) + '</div></div>';
      });
    }
    html += '</div></div>';
  }
  return html + '</div></div>';
}

// Render maand
function renderMaand() {
  var jaar = anker.getFullYear(), mnd = anker.getMonth();
  document.getElementById('nav-label').textContent = MAANDEN[mnd].charAt(0).toUpperCase() + MAANDEN[mnd].slice(1) + ' ' + jaar;
  var eerste = new Date(jaar, mnd, 1), laatste = new Date(jaar, mnd+1, 0);
  var start = new Date(eerste), dow = start.getDay();
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));
  var html = '<div class="month-grid">';
  ['Ma','Di','Wo','Do','Vr','Za','Zo'].forEach(function(d){ html += '<div class="month-day-name">' + d + '</div>'; });
  var vds = datumNaarStr(new Date()), cur = new Date(start);
  while (cur <= laatste || cur.getDay() !== 1) {
    var ds = datumNaarStr(cur), andereM = cur.getMonth() !== mnd, isToday = ds === vds;
    var dagBoek = boekVoorDag(ds);
    html += '<div class="month-cell' + (isToday ? ' today-cell' : '') + (andereM ? ' other-month' : '') + '" onclick="naarDag(\'' + ds + '\')"><div class="month-num">' + cur.getDate() + '</div>';
    dagBoek.slice(0,2).forEach(function(b){ html += '<div class="month-pill' + (b.betaling === 'achteraf' ? ' onbetaald' : '') + '">' + escHtml(b.naam) + '</div>'; });
    if (dagBoek.length > 2) html += '<div class="month-more">+' + (dagBoek.length-2) + ' meer</div>';
    html += '</div>';
    cur.setDate(cur.getDate() + 1);
    if (cur > laatste && cur.getDay() === 1) break;
  }
  return html + '</div>';
}

// Hoofd render
function renderOverzicht() {
  var c = document.getElementById('overzicht');
  if (huidigView === 'dag') {
    document.getElementById('nav-label').textContent = DAGEN[anker.getDay()].charAt(0).toUpperCase() + DAGEN[anker.getDay()].slice(1) + ' ' + anker.getDate() + ' ' + MAANDEN[anker.getMonth()] + ' ' + anker.getFullYear();
    c.innerHTML = renderDag(datumNaarStr(anker));
  } else if (huidigView === 'week') {
    c.innerHTML = renderWeek();
  } else {
    c.innerHTML = renderMaand();
  }
}

// Event listeners - pas koppelen als DOM klaar is
/* ===== EMAILJS ===== */
var EMAILJS_SERVICE = 'service_p4qynsf';
var EMAILJS_TEMPLATE_WELKOM = 'template_6fe802x';
var extraScripts = Object.create(null);
function laadExtraScript(naam, url, leesBibliotheek) {
  if (leesBibliotheek()) return Promise.resolve(leesBibliotheek());
  if (extraScripts[naam]) return extraScripts[naam];
  extraScripts[naam] = new Promise(function(resolve, reject) {
    var script = document.createElement('script'); script.src = url; script.async = true;
    script.onload = function() {
      if (leesBibliotheek()) resolve(leesBibliotheek());
      else { delete extraScripts[naam]; script.remove(); reject(new Error('Dit onderdeel kon niet worden geladen. Probeer opnieuw.')); }
    };
    script.onerror = function() { delete extraScripts[naam]; script.remove(); reject(new Error('Dit onderdeel kon niet worden geladen. Controleer je verbinding.')); };
    document.head.appendChild(script);
  });
  return extraScripts[naam];
}

function stuurWelkomMail(naam, email) {
  return laadExtraScript('email', 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', function() { return window.emailjs; }).then(function(mail) {
    mail.init('M3DlFPKyVkfE_MTo9');
    return mail.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE_WELKOM, {naam: naam, gebruikersnaam: naam, email: email});
  });
}


/* ===== WACHTWOORD RESET ===== */


/* ===== UITNODIGINGSCODES ===== */


function adminTabWissel(tab) {
  ['codes','gebruikers','topseller','updates','meldingen'].forEach(function(t) {
    var s = document.getElementById('admin-sectie-'+t);
    var b = document.getElementById('admin-tab-'+t);
    if (s) s.style.display = tab===t ? 'block' : 'none';
    if (b) b.classList.toggle('active', tab===t);
  });
  if (tab==='gebruikers') renderAdminGebruikers();
  if (tab==='topseller') renderTopSeller('admin');
  if (tab==='updates') renderAdminUpdates();
  if (tab==='meldingen') renderAdminMeldingen();
}

function bevestigVerwijderGebruiker(user) {
  document.getElementById('verwijder-gebruiker-tekst').innerHTML =
    'Je staat op het punt om <strong style="color:var(--text);">@' + escHtml(user) + '</strong> te verwijderen uit het systeem.';
  document.getElementById('verwijder-gebruiker-overlay').style.display = 'flex';
  document.getElementById('verwijder-gebruiker-overlay').dataset.user = user;
}

function verwijderGebruiker(user) {
  var batch = db.batch();
  batch.delete(db.collection('accounts').doc(user));
  batch.delete(db.collection('instellingen').doc(user));
  batch.delete(db.collection('resets').doc(user));
  db.collection('boekingen').where('gebruiker','==',user).get().then(function(snap) {
    snap.docs.forEach(function(d){ batch.delete(d.ref); });
    return batch.commit();
  }).then(function() {
    document.getElementById('verwijder-gebruiker-overlay').style.display='none';
    renderAdminGebruikers();
  });
}

function formatLaatstOnline(iso) {
  if (!iso) return 'Nooit';
  var d = new Date(iso);
  var nu = new Date();
  var diff = Math.floor((nu - d) / 1000);
  if (diff < 60) return 'Zojuist';
  if (diff < 3600) return Math.floor(diff/60) + ' min geleden';
  if (diff < 86400) return Math.floor(diff/3600) + ' uur geleden';
  if (diff < 604800) return Math.floor(diff/86400) + ' dag(en) geleden';
  return d.getDate() + ' ' + ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][d.getMonth()] + ' ' + d.getFullYear();
}

// Beheerder aan/uit zetten
function wisselBeheerder() {
  alert('Beheerdersrechten worden door de eigenaar van de app beheerd.');
}

// ===== BEHEERDERSPAGINA (voor gebruikers met isBeheerder) =====
function openBeheerPagina() {
  if (!isBeheerder()) return;
  if (authRechten.admin === true) return openAdminPaneel();
  toonPagina('beheer');
  beheerTabWissel('codes');
}

function beheerTabWissel(tab) {
  ['codes','gebruikers','topseller','updates','meldingen'].forEach(function(t) {
    var s = document.getElementById('beheer-sectie-'+t);
    var b = document.getElementById('beheer-tab-'+t);
    if (s) s.style.display = tab===t ? '' : 'none';
    if (b) b.classList.toggle('active', tab===t);
  });
  if (tab==='codes') renderBeheerCodes();
  else if (tab==='gebruikers') renderBeheerGebruikers();
  else if (tab==='topseller') renderTopSeller('beheer');
  else if (tab==='updates') renderBeheerUpdates();
  else if (tab==='meldingen') renderBeheerMeldingen();
}

function renderBeheerCodes() { return laadCodeLijst('beheer-codes-lijst', false); }

function renderBeheerGebruikers() {
  var lijst = document.getElementById('beheer-gebruikers-lijst');
  if (!lijst) return;
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('accounts').get().then(function(snap) {
    var gebruikers = snap.docs.map(function(d){ return d.data(); });
    if (!gebruikers.length) { lijst.innerHTML='<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen gebruikers geregistreerd</p>'; return; }
    lijst.innerHTML = '<p style="font-size:0.65rem;color:var(--muted);margin-bottom:12px;">'+gebruikers.length+' gebruiker(s) geregistreerd</p>' +
      gebruikers.map(function(g) {
        var online=formatLaatstOnline(g.laatstOnline), isRecent=g.laatstOnline&&(new Date()-new Date(g.laatstOnline))<300000;
        var isBeh = !!g.isBeheerder;
        return '<div class="gebruiker-rij"><div class="gebruiker-avatar" onclick="toonGebruikerDetail(\''+escHtml(g.gebruiker)+'\')" style="cursor:pointer;">'+g.gebruiker.charAt(0).toUpperCase()+'</div><div class="gebruiker-info"><div class="gebruiker-naam gebruiker-naam-link" onclick="toonGebruikerDetail(\''+escHtml(g.gebruiker)+'\')" ><span class="online-dot '+(isRecent?'online':'offline')+'"></span>@'+escHtml(g.gebruiker)+(isBeh?' <span style="font-size:0.6rem;background:var(--accent);color:var(--bg);border-radius:4px;padding:1px 5px;vertical-align:middle;">beheerder</span>':'')+'</div><div class="gebruiker-email">'+escHtml(g.email)+'</div></div><div class="gebruiker-datum"><div style="font-size:0.62rem;color:var(--muted);">Lid sinds<br>'+escHtml(g.aangemaakt||'—')+'</div><div style="font-size:0.62rem;margin-top:4px;color:'+(isRecent?'var(--success)':'var(--muted)')+';">'+online+'</div></div></div>';
      }).join('');
  });
}

function renderAdminGebruikers() {
  var lijst = document.getElementById('admin-gebruikers-lijst');
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('accounts').get().then(function(snap) {
    var gebruikers = snap.docs.map(function(d){ return d.data(); });
    if (!gebruikers.length) { lijst.innerHTML='<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen gebruikers geregistreerd</p>'; return; }
    lijst.innerHTML = '<p style="font-size:0.65rem;color:var(--muted);margin-bottom:12px;">'+gebruikers.length+' gebruiker(s) geregistreerd</p>' +
      gebruikers.map(function(g) {
        var online=formatLaatstOnline(g.laatstOnline), isRecent=g.laatstOnline&&(new Date()-new Date(g.laatstOnline))<300000;
        var isBeh = !!g.isBeheerder;
        return '<div class="gebruiker-rij"><div class="gebruiker-avatar" onclick="toonGebruikerDetail(\''+escHtml(g.gebruiker)+'\')" style="cursor:pointer;">'+g.gebruiker.charAt(0).toUpperCase()+'</div><div class="gebruiker-info"><div class="gebruiker-naam gebruiker-naam-link" onclick="toonGebruikerDetail(\''+escHtml(g.gebruiker)+'\')" ><span class="online-dot '+(isRecent?'online':'offline')+'"></span>@'+escHtml(g.gebruiker)+(isBeh?' <span style="font-size:0.6rem;background:var(--accent);color:var(--bg);border-radius:4px;padding:1px 5px;vertical-align:middle;">beheerder</span>':'')+'</div><div class="gebruiker-email">'+escHtml(g.email)+'</div></div><div class="gebruiker-datum"><div style="font-size:0.62rem;color:var(--muted);">Lid sinds<br>'+escHtml(g.aangemaakt||'—')+'</div><div style="font-size:0.62rem;margin-top:4px;color:'+(isRecent?'var(--success)':'var(--muted)')+';">'+online+'</div></div><div style="display:flex;flex-direction:column;gap:4px;margin-left:8px;"><button onclick="bevestigVerwijderGebruiker(\''+escHtml(g.gebruiker)+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;padding:3px 7px;border-radius:6px;" onmouseover="this.style.color=\'var(--error)\'" onmouseout="this.style.color=\'var(--muted)\'">&#10005;</button></div></div>';
      }).join('');
  });
}


/* ===== GEBRUIKER DETAIL ===== */
var detailBoekingen = [];
var detailUsername = '';
var detailMinGap = 95, detailOpen = 540, detailSluit = 1440;
var detailStatPeriode = 'dag';
var detailStatAnker = new Date();
var detailBoekView = 'week';
var detailBoekAnker = new Date();
var MNDKORT_D = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];

function detailBoekVoorDag(ds) {
  return detailBoekingen.filter(function(b){ return b.datumStr===ds; }).sort(function(a,b){ return a.start-b.start; });
}

function detailTab(naam, btn) {
  document.querySelectorAll('.detail-sectie').forEach(function(s){ s.classList.remove('actief'); });
  document.querySelectorAll('.detail-tab').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('detail-'+naam).classList.add('actief');
  btn.classList.add('active');
  if (naam==='statistieken') renderDetailStatistieken();
  else if (naam==='boekingen') renderDetailBoekingen();
  else if (naam==='activiteit') renderDetailActiviteit();
}

function sluitGebruikerDetail(e) {
  if (e && e.target !== document.getElementById('gebruiker-detail-overlay')) return;
  document.getElementById('gebruiker-detail-overlay').style.display = 'none';
}

/* --- STATISTIEKEN --- */
function renderDetailStatLabel() {
  if (detailStatPeriode==='dag') {
    return datumNaarStr(detailStatAnker)===datumNaarStr(new Date())?'Vandaag':datumNaarStr(detailStatAnker);
  } else if (detailStatPeriode==='week') {
    var ma=getMaandagVanWeek(detailStatAnker), zo=new Date(ma); zo.setDate(zo.getDate()+6);
    return ma.getDate()+' – '+zo.getDate()+' '+MAANDEN[zo.getMonth()].slice(0,3)+' '+zo.getFullYear();
  } else {
    return MAANDEN[detailStatAnker.getMonth()].charAt(0).toUpperCase()+MAANDEN[detailStatAnker.getMonth()].slice(1)+' '+detailStatAnker.getFullYear();
  }
}

function renderDetailStatistieken() {
  var boek=[];
  if (detailStatPeriode==='dag') {
    boek=detailBoekingen.filter(function(b){ return b.datumStr===datumNaarStr(detailStatAnker); });
  } else if (detailStatPeriode==='week') {
    var ma=getMaandagVanWeek(detailStatAnker), zo=new Date(ma); zo.setDate(zo.getDate()+6);
    boek=detailBoekingen.filter(function(b){ var d=strNaarDatum(b.datumStr); return d>=ma&&d<=zo; });
  } else {
    boek=detailBoekingen.filter(function(b){ var d=strNaarDatum(b.datumStr); return d.getMonth()===detailStatAnker.getMonth()&&d.getFullYear()===detailStatAnker.getFullYear(); });
  }
  var betaald=boek.filter(function(b){ return b.betaling==='betaald'; });
  var achteraf=boek.filter(function(b){ return b.betaling==='achteraf'; });
  var totaalBetaald=betaald.reduce(function(s,b){ return s+((b.prijs == null ? 10 : b.prijs)); },0);
  var totaalOpenstaand=achteraf.reduce(function(s,b){ return s+((b.prijs == null ? 10 : b.prijs)); },0);
  var gemiddeld=betaald.length>0?(totaalBetaald/betaald.length).toFixed(2):'0.00';
  var platforms=Object.create(null);
  boek.forEach(function(b){ var p=b.platform||'overig'; platforms[p]=(platforms[p]||0)+1; });
  var platArr=Object.keys(platforms).sort(function(a,b){ return platforms[b]-platforms[a]; });
  document.getElementById('detail-statistieken').innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;">'+
      '<div class="view-tabs">'+
        '<button class="view-tab'+(detailStatPeriode==='dag'?' active':'')+'" onclick="detailStatSetPeriode(\'dag\')">Dag</button>'+
        '<button class="view-tab'+(detailStatPeriode==='week'?' active':'')+'" onclick="detailStatSetPeriode(\'week\')">Week</button>'+
        '<button class="view-tab'+(detailStatPeriode==='maand'?' active':'')+'" onclick="detailStatSetPeriode(\'maand\')">Maand</button>'+
      '</div>'+
      '<div class="nav-btns">'+
        '<button class="nav-btn" onclick="detailStatNavigeer(-1)">&#8592;</button>'+
        '<div class="nav-label">'+renderDetailStatLabel()+'</div>'+
        '<button class="nav-btn" onclick="detailStatNavigeer(1)">&#8594;</button>'+
      '</div>'+
    '</div>'+
    '<div class="detail-stat-grid">'+
      '<div class="detail-stat-kaart"><div class="detail-stat-label">Boekingen</div><div class="detail-stat-waarde">'+boek.length+'</div><div style="font-size:0.65rem;color:var(--muted);margin-top:4px;">'+betaald.length+' betaald &middot; '+achteraf.length+' achteraf</div></div>'+
      '<div class="detail-stat-kaart"><div class="detail-stat-label">Ontvangen</div><div class="detail-stat-waarde">&euro; '+totaalBetaald.toFixed(2)+'</div><div style="font-size:0.65rem;color:var(--muted);margin-top:4px;">'+betaald.length+' betalingen</div></div>'+
      '<div class="detail-stat-kaart"><div class="detail-stat-label">Gemiddeld</div><div class="detail-stat-waarde">&euro; '+gemiddeld+'</div><div style="font-size:0.65rem;color:var(--muted);margin-top:4px;">per betaalde boeking</div></div>'+
      '<div class="detail-stat-kaart"><div class="detail-stat-label">Openstaand</div><div class="detail-stat-waarde" style="color:#f4a0b8;">&euro; '+totaalOpenstaand.toFixed(2)+'</div><div style="font-size:0.65rem;color:var(--muted);margin-top:4px;">'+achteraf.length+' achteraf</div></div>'+
    '</div>'+
    '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:12px;">'+
      '<div style="font-size:0.6rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Platforms</div>'+
      (platArr.length?platArr.map(function(p){ return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.78rem;"><span style="color:var(--text);text-transform:capitalize;">'+escHtml(p)+'</span><span style="color:var(--accent);">'+platforms[p]+'x</span></div>'; }).join(''):'<div style="font-size:0.72rem;color:var(--muted);">Geen data voor deze periode</div>')+
    '</div>';
}

function detailStatSetPeriode(p) { detailStatPeriode=p; renderDetailStatistieken(); }
function detailStatNavigeer(dir) {
  if (detailStatPeriode==='dag') { detailStatAnker=new Date(detailStatAnker); detailStatAnker.setDate(detailStatAnker.getDate()+dir); }
  else if (detailStatPeriode==='week') { detailStatAnker=new Date(detailStatAnker); detailStatAnker.setDate(detailStatAnker.getDate()+dir*7); }
  else { detailStatAnker=new Date(detailStatAnker); detailStatAnker.setMonth(detailStatAnker.getMonth()+dir); }
  renderDetailStatistieken();
}

/* --- BOEKINGEN --- */
function renderDetailDag(ds) {
  var d=strNaarDatum(ds), dagNaam=DAGEN[d.getDay()], isToday=isVandaag(ds);
  var dagBoek=detailBoekVoorDag(ds);
  var html='<div class="day-header'+(isToday?' today-label':'')+'"><span>'+dagNaam.charAt(0).toUpperCase()+dagNaam.slice(1)+' '+d.getDate()+' '+MAANDEN[d.getMonth()]+' '+d.getFullYear()+(isToday?' – vandaag':'')+' </span></div>';
  if (!dagBoek.length) { html+='<div class="empty-day">Geen boekingen op deze dag</div>'; }
  else {
    dagBoek.forEach(function(b,i){
      var prev = i > 0 ? dagBoek[i-1] : null;
      var next = i < dagBoek.length-1 ? dagBoek[i+1] : null;
      var lv = b.start - detailMinGap, vv = b.start + detailMinGap;
      var ruimteVoor = !prev ? (lv >= detailOpen) : (b.start - prev.start >= detailMinGap * 2);
      var ruimteNa = !next ? true : (next.start - b.start >= detailMinGap * 2);
      if (ruimteVoor) {
        if (lv >= detailOpen) html += '<div class="slot-indicator slot-prev"><span class="slot-label">Vorige uiterlijk</span><span class="slot-time-blue">'+minNaarTijd(lv)+'</span></div>';
        else html += '<div class="slot-indicator slot-prev"><span class="slot-label">Vorige uiterlijk</span><span class="slot-closed">Voor openingstijd</span></div>';
      }
      var detailTvBadge = b.tijdvak != null ? '<span style="font-size:0.58rem;background:rgba(138,180,212,0.15);color:var(--blue);border:1px solid rgba(138,180,212,0.3);border-radius:3px;padding:0 5px;margin-left:5px;vertical-align:middle;">T'+(b.tijdvak+1)+'</span>' : '';
      html+='<div class="booking-item'+(b.betaling==='achteraf'?' onbetaald':'')+'">'+
        '<div class="booking-left"><div class="booking-num">'+(i+1)+'</div>'+
        '<div><div class="booking-name">'+escHtml(b.naam)+detailTvBadge+'</div>'+
        '<div class="booking-time">&#9201; '+minNaarTijd(b.start)+' – '+minNaarTijd(b.eind)+'</div>'+
        '<div class="booking-dur">'+(b.platform?escHtml(b.platform)+' &nbsp;&middot;&nbsp; ':'')+escHtml(b.betaling)+' &nbsp;&middot;&nbsp; &euro; '+((b.prijs == null ? 10 : b.prijs)).toFixed(2)+'</div>'+
        '</div></div>'+
        '<span style="font-size:0.68rem;padding:3px 8px;border-radius:5px;background:'+(b.betaling==='betaald'?'rgba(126,200,150,0.12)':'rgba(244,160,184,0.12)')+';color:'+(b.betaling==='betaald'?'var(--success)':'#f4a0b8')+';">'+escHtml(b.betaling)+'</span>'+
      '</div>';
      if (ruimteNa) {
        if (vv < detailSluit) html += '<div class="slot-indicator slot-next"><span class="slot-label">Volgende vanaf</span><span class="slot-time-gold">'+minNaarTijd(vv)+'</span></div>';
        else html += '<div class="slot-indicator slot-next"><span class="slot-label">Volgende vanaf</span><span class="slot-closed">Niet meer mogelijk</span></div>';
      }
    });
  }
  return html;
}

function renderDetailWeek() {
  var ma=getMaandagVanWeek(detailBoekAnker);
  var html='<div class="week-grid-wrapper"><div class="week-grid">';
  for (var i=0;i<7;i++) {
    var dag=new Date(ma); dag.setDate(dag.getDate()+i);
    var ds=datumNaarStr(dag), isToday=isVandaag(ds), isPast=dag<new Date().setHours(0,0,0,0)&&!isToday;
    var dagBoek=detailBoekVoorDag(ds), dagKort=DAGEN_KORT[dag.getDay()].toUpperCase();
    html+='<div class="week-col'+(isToday?' today-col':'')+(isPast?' past-col':'')+'" onclick="detailNaarDag(\''+ds+'\')">" style="cursor:pointer;">'+
      '<div class="week-col-header"><div>'+dagKort+'</div><div class="week-col-date">'+dag.getDate()+'</div></div>'+
      '<div class="week-bookings">';
    if (!dagBoek.length) { html+='<div class="week-empty">vrij</div>'; }
    else { dagBoek.forEach(function(b){ html+='<div class="week-booking-pill'+(b.betaling==='achteraf'?' onbetaald':'')+'"><div class="week-pill-name">'+escHtml(b.naam)+'</div><div class="week-pill-time">'+minNaarTijd(b.start)+'-'+minNaarTijd(b.eind)+'</div></div>'; }); }
    html+='</div></div>';
  }
  return html+'</div></div>';
}

function renderDetailMaand() {
  var jaar=detailBoekAnker.getFullYear(), mnd=detailBoekAnker.getMonth();
  var eerste=new Date(jaar,mnd,1), laatste=new Date(jaar,mnd+1,0);
  var start=new Date(eerste); start.setDate(start.getDate()-((start.getDay()===0?6:start.getDay()-1)));
  var html='<div class="month-grid">';
  ['Ma','Di','Wo','Do','Vr','Za','Zo'].forEach(function(d){ html+='<div class="month-day-name">'+d+'</div>'; });
  var cur=new Date(start), vds=datumNaarStr(new Date());
  while(cur<=laatste||cur.getDay()!==1){
    var ds=datumNaarStr(cur), andereM=cur.getMonth()!==mnd, isToday=ds===vds;
    var dagBoek=detailBoekVoorDag(ds);
    html+='<div class="month-cell'+(isToday?' today-cell':'')+(andereM?' other-month':'')+'" onclick="detailNaarDag(\''+ds+'\')">">'+
      '<div class="month-num">'+cur.getDate()+'</div>';
    dagBoek.slice(0,2).forEach(function(b){ html+='<div class="month-pill'+(b.betaling==='achteraf'?' onbetaald':'')+'">'+escHtml(b.naam)+'</div>'; });
    if (dagBoek.length>2) html+='<div class="month-more">+'+(dagBoek.length-2)+' meer</div>';
    html+='</div>';
    cur.setDate(cur.getDate()+1); if(cur>laatste&&cur.getDay()===1)break;
  }
  return html+'</div>';
}

function detailNaarDag(ds) {
  detailBoekAnker=strNaarDatum(ds); detailBoekView='dag'; renderDetailBoekingen();
}

function renderDetailBoekLabel() {
  if (detailBoekView==='dag') {
    return DAGEN[detailBoekAnker.getDay()].charAt(0).toUpperCase()+DAGEN[detailBoekAnker.getDay()].slice(1)+' '+detailBoekAnker.getDate()+' '+MAANDEN[detailBoekAnker.getMonth()]+' '+detailBoekAnker.getFullYear();
  } else if (detailBoekView==='week') {
    var ma=getMaandagVanWeek(detailBoekAnker), zo=new Date(ma); zo.setDate(zo.getDate()+6);
    return ma.getDate()+' '+MAANDEN[ma.getMonth()].slice(0,3)+' – '+zo.getDate()+' '+MAANDEN[zo.getMonth()].slice(0,3)+' '+zo.getFullYear();
  } else {
    return MAANDEN[detailBoekAnker.getMonth()].charAt(0).toUpperCase()+MAANDEN[detailBoekAnker.getMonth()].slice(1)+' '+detailBoekAnker.getFullYear();
  }
}

function renderDetailBoekingen() {
  var content='';
  if (detailBoekView==='dag') content=renderDetailDag(datumNaarStr(detailBoekAnker));
  else if (detailBoekView==='week') content=renderDetailWeek();
  else content=renderDetailMaand();
  document.getElementById('detail-boekingen').innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;">'+
      '<div class="view-tabs">'+
        '<button class="view-tab'+(detailBoekView==='dag'?' active':'')+'" onclick="detailBoekSetView(\'dag\')">Dag</button>'+
        '<button class="view-tab'+(detailBoekView==='week'?' active':'')+'" onclick="detailBoekSetView(\'week\')">Week</button>'+
        '<button class="view-tab'+(detailBoekView==='maand'?' active':'')+'" onclick="detailBoekSetView(\'maand\')">Maand</button>'+
      '</div>'+
      '<div class="nav-btns">'+
        '<button class="nav-btn" onclick="detailBoekNavigeer(-1)">&#8592;</button>'+
        '<div class="nav-label">'+renderDetailBoekLabel()+'</div>'+
        '<button class="nav-btn" onclick="detailBoekNavigeer(1)">&#8594;</button>'+
      '</div>'+
    '</div>'+
    '<div id="detail-boek-content">'+content+'</div>';
  var el=document.getElementById('detail-boek-content');
  var tx=0;
  el.addEventListener('touchstart',function(e){ tx=e.touches[0].clientX; },{passive:true});
  el.addEventListener('touchend',function(e){ var diff=tx-e.changedTouches[0].clientX; if(Math.abs(diff)>50) detailBoekNavigeer(diff>0?1:-1); },{passive:true});
}

function detailBoekSetView(v) { detailBoekView=v; renderDetailBoekingen(); }
function detailBoekNavigeer(dir) {
  if (detailBoekView==='dag') { detailBoekAnker=new Date(detailBoekAnker); detailBoekAnker.setDate(detailBoekAnker.getDate()+dir); }
  else if (detailBoekView==='week') { detailBoekAnker=new Date(detailBoekAnker); detailBoekAnker.setDate(detailBoekAnker.getDate()+dir*7); }
  else { detailBoekAnker=new Date(detailBoekAnker); detailBoekAnker.setMonth(detailBoekAnker.getMonth()+dir); }
  renderDetailBoekingen();
}

/* --- ACTIVITEIT --- */
function renderDetailActiviteit() {
  db.collection('accounts').doc(detailUsername).get().then(function(doc) {
    if (!doc.exists) return;
    var account = doc.data();
    var isOnline=account.laatstOnline&&(new Date()-new Date(account.laatstOnline))<5*60*1000;
    var log=account.loginLog||[];
    document.getElementById('detail-activiteit').innerHTML=
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:14px;">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:0.6rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">Accountgegevens</div>'+
        '<div class="detail-log-item"><span style="color:var(--muted);">Lid sinds</span><span style="color:var(--text);">'+escHtml(account.aangemaakt||'—')+'</span></div>'+
        '<div class="detail-log-item"><span style="color:var(--muted);">Laatste activiteit</span><span style="color:var(--text);">'+formatLaatstOnline(account.laatstOnline)+'</span></div>'+
        '<div class="detail-log-item"><span style="color:var(--muted);">Status nu</span>'+
          '<span style="color:'+(isOnline?'var(--success)':'var(--muted)')+';">'+
            '<span class="online-dot '+(isOnline?'online':'offline')+'"></span>'+(isOnline?'Online':'Offline')+
          '</span></div>'+
      '</div>'+
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:0.6rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">Inloggeschiedenis ('+log.length+')</div>'+
        (log.length===0
          ? '<div style="padding:16px;font-size:0.72rem;color:var(--muted);text-align:center;">Nog geen inloggeschiedenis</div>'
          : log.map(function(entry){
              var d=new Date(entry.timestamp);
              var txt=d.getDate()+' '+MNDKORT_D[d.getMonth()]+' '+d.getFullYear()+' om '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
              return '<div class="detail-log-item"><span style="color:var(--text);">🔒 Ingelogd</span><span style="color:var(--muted);font-size:0.68rem;">'+txt+'</span></div>';
            }).join(''))+
      '</div>';
  });
}

/* --- HOOFDFUNCTIE --- */
function toonGebruikerDetail(username) {
  detailUsername = username;
  detailStatPeriode='dag'; detailStatAnker=new Date();
  detailBoekView='week'; detailBoekAnker=new Date();
  detailMinGap=95; detailOpen=540; detailSluit=1440;
  Promise.all([
    db.collection('accounts').doc(username).get(),
    db.collection('boekingen').where('gebruiker','==',username).get(),
    db.collection('instellingen').doc(username).get()
  ]).then(function(results) {
    var accountDoc = results[0];
    var boekingenSnap = results[1];
    var instDoc = results[2];
    if (!accountDoc.exists) return;
    var account = accountDoc.data();
    // Laad instellingen van deze gebruiker
    if (instDoc.exists) {
      var inst = instDoc.data();
      if (inst.minGap) detailMinGap = inst.minGap;
      if (inst.open != null) detailOpen = inst.open;
      if (inst.sluit != null) detailSluit = inst.sluit;
    }
    detailBoekingen = boekingenSnap.docs.map(function(d){ return d.data(); });
    var isOnline = account.laatstOnline&&(new Date()-new Date(account.laatstOnline))<5*60*1000;
    // Avatar met foto indien beschikbaar
    var avatarEl = document.getElementById('detail-avatar');
    if (veiligeFoto(account.foto)) {
      avatarEl.innerHTML = '<img src="'+veiligeFoto(account.foto)+'" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />';
    } else {
      avatarEl.textContent = username.charAt(0).toUpperCase();
    }
    document.getElementById('detail-naam').textContent = '@'+username;
    document.getElementById('detail-email').textContent = account.email||'';
    document.getElementById('detail-online-status').innerHTML =
      '<span class="online-dot '+(isOnline?'online':'offline')+'"></span>'+
      (isOnline
        ? '<span style="color:var(--success);font-size:0.72rem;">Nu online</span>'
        : '<span style="color:var(--muted);font-size:0.72rem;">Laatste activiteit: '+formatLaatstOnline(account.laatstOnline)+'</span>');
    document.querySelectorAll('.detail-sectie').forEach(function(s){ s.classList.remove('actief'); });
    document.querySelectorAll('.detail-tab').forEach(function(b){ b.classList.remove('active'); });
    document.getElementById('detail-statistieken').classList.add('actief');
    document.querySelector('.detail-tab').classList.add('active');
    renderDetailStatistieken();
    document.getElementById('gebruiker-detail-overlay').style.display='flex';
  });
}

function kopieerCode(btn, code) {
  var origineel = btn.textContent;
  function bevestigd() {
    btn.textContent = 'Gekopieerd';
    setTimeout(function(){ btn.textContent = origineel; }, 1500);
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(bevestigd).catch(fallback);
  } else { fallback(); }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = code; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try { if (document.execCommand('copy')) bevestigd(); } catch(e){}
    document.body.removeChild(ta);
  }
}

function renderAdminCodes() { return laadCodeLijst('admin-codes-lijst', true); }

function laadCodeLijst(id, magVerwijderen) {
  var lijst = document.getElementById(id), generatie = authGeneratie;
  lijst.textContent = 'Codes ophalen…';
  return getCodes().then(function(codes) {
    if (generatie !== authGeneratie) return;
    lijst.replaceChildren();
    if (!codes.length) { lijst.textContent = 'Nog geen codes aangemaakt'; return; }
    codes.forEach(function(c) {
      var code = String(c.code || c.id || '');
      var card = document.createElement('article'); card.className = 'beheer-code';
      var hoofd = document.createElement('div'); hoofd.className = 'code-hoofd';
      var details = document.createElement('details'); details.className = 'code-details';
      var summary = document.createElement('summary');
      summary.textContent = code.length > 12 ? code.slice(0, 6) + '…' + code.slice(-4) : code;
      summary.setAttribute('aria-label', 'Volledige uitnodigingscode tonen');
      var volledig = document.createElement('code'); volledig.className = 'code-volledig'; volledig.textContent = code;
      details.append(summary, volledig);
      var status = document.createElement('span'); status.className = 'code-status ' + (c.gebruikt ? 'gebruikt' : 'beschikbaar');
      status.textContent = c.gebruikt ? 'Gebruikt' : 'Beschikbaar';
      hoofd.append(details, status); card.appendChild(hoofd);
      if (c.gebruiker) {
        var eigenaar = document.createElement('p'); eigenaar.className = 'code-eigenaar'; eigenaar.textContent = '@' + c.gebruiker;
        card.appendChild(eigenaar);
      }
      var acties = document.createElement('div'); acties.className = 'code-acties';
      var kopie = document.createElement('button'); kopie.type = 'button'; kopie.textContent = 'Kopieer code';
      kopie.addEventListener('click', function() { kopieerCode(kopie, code); }); acties.appendChild(kopie);
      if (magVerwijderen && !c.gebruikt) {
        var verwijder = document.createElement('button'); verwijder.type = 'button'; verwijder.textContent = 'Verwijderen';
        verwijder.addEventListener('click', function() { verwijderCode(c.id); }); acties.appendChild(verwijder);
      }
      card.appendChild(acties); lijst.appendChild(card);
    });
  }).catch(function() { if (generatie === authGeneratie) lijst.textContent = 'Codes konden niet worden opgehaald. Open dit onderdeel opnieuw.'; });
}

function verwijderCode(id) {
  verwijderCodeFirestore(id).then(renderAdminCodes);
}

// Admin panel event listeners - verplaatst naar hoofd DOMContentLoaded

/* ===== STATISTIEKEN ===== */
var statPeriode = 'dag';
var statAnker = new Date();
var statGeselecteerdeDag = null;

function statSelecteerDag(ds) { statGeselecteerdeDag = ds; renderStatistieken(); }

function statNavigeer(dir) {
  statGeselecteerdeDag = null;
  if (statPeriode==='dag') { statAnker=new Date(statAnker); statAnker.setDate(statAnker.getDate()+dir); }
  else if (statPeriode==='week') { statAnker=new Date(statAnker); statAnker.setDate(statAnker.getDate()+dir*7); }
  else if (statPeriode==='maand') { statAnker=new Date(statAnker); statAnker.setMonth(statAnker.getMonth()+dir); }
  else if (statPeriode==='jaar') { statAnker=new Date(statAnker); statAnker.setFullYear(statAnker.getFullYear()+dir); }
  renderStatistieken();
}

function renderStatSelector() {
  var sel = document.getElementById('stat-selector');
  var vandaagStr = datumNaarStr(new Date());
  if (statPeriode==='dag'||statPeriode==='jaar') { sel.innerHTML=''; return; }
  if (statPeriode==='week') {
    var ma=getMaandagVanWeek(statAnker);
    var html='<div class="stat-dag-grid">';
    for (var i=0;i<7;i++) {
      var d=new Date(ma); d.setDate(d.getDate()+i);
      var ds=datumNaarStr(d);
      var dagN=['Ma','Di','Wo','Do','Vr','Za','Zo'][d.getDay()===0?6:d.getDay()-1];
      var actief=statGeselecteerdeDag===ds||(!statGeselecteerdeDag&&ds===datumNaarStr(statAnker));
      var heeftB=boekingen.some(function(b){return b.datumStr===ds;});
      html+='<div class="stat-dag-cel'+(actief?' actief':'')+(ds===vandaagStr?' vandaag-cel':'')+'" onclick="statSelecteerDag(\''+ds+'\')">';
      html+='<div class="stat-dag-naam">'+dagN+'</div><div class="stat-dag-num">'+d.getDate()+'</div>';
      if(heeftB) html+='<div class="stat-dag-dot"></div>';
      html+='</div>';
    }
    sel.innerHTML=html+'</div>';
  }
  if (statPeriode==='maand') {
    var jaar=statAnker.getFullYear(),mnd=statAnker.getMonth();
    var eerste=new Date(jaar,mnd,1),laatste=new Date(jaar,mnd+1,0);
    var start=new Date(eerste); var dow=start.getDay(); start.setDate(start.getDate()-(dow===0?6:dow-1));
    var html2='<div class="stat-maand-grid">';
    ['Ma','Di','Wo','Do','Vr','Za','Zo'].forEach(function(d){html2+='<div style="font-size:0.58rem;color:var(--muted);text-align:center;padding:4px 0;">'+d+'</div>';});
    var cur=new Date(start);
    while(cur<=laatste||cur.getDay()!==1){
      var ds3=datumNaarStr(cur);
      var andereM=cur.getMonth()!==mnd;
      var actief2=statGeselecteerdeDag===ds3;
      var heeftB2=boekingen.some(function(b){return b.datumStr===ds3;});
      html2+='<div class="stat-maand-cel'+(actief2?' actief':'')+(ds3===vandaagStr?' vandaag-cel':'')+(andereM?' andere-maand':'')+'" onclick="statSelecteerDag(\''+ds3+'\')">';
      html2+='<div class="stat-maand-num">'+cur.getDate()+'</div>';
      if(heeftB2) html2+='<div style="width:4px;height:4px;border-radius:50%;background:var(--success);margin:2px auto 0;"></div>';
      html2+='</div>';
      cur.setDate(cur.getDate()+1); if(cur>laatste&&cur.getDay()===1)break;
    }
    sel.innerHTML=html2+'</div>';
  }
}

var grafiekData = {labels:[], data:[], pad:{}, cW:0, cH:0};

function renderGrafiek(labels,data) {
  var canvas=document.getElementById('stat-grafiek');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  canvas.width=canvas.offsetWidth||600; canvas.height=180;
  var w=canvas.width,h=canvas.height,pad={top:20,right:16,bottom:32,left:44};
  var cW=w-pad.left-pad.right,cH=h-pad.top-pad.bottom;
  grafiekData={labels:labels,data:data,pad:pad,cW:cW,cH:cH,w:w,h:h};
  ctx.clearRect(0,0,w,h);
  if(!data.length||data.every(function(v){return v===0;})){
    ctx.fillStyle='#7a7870'; ctx.font='13px monospace'; ctx.textAlign='center';
    ctx.fillText('Geen data beschikbaar',w/2,h/2); return;
  }
  var maxVal=Math.max.apply(null,data)||1;
  ctx.strokeStyle='#2e2d2a'; ctx.lineWidth=1;
  for(var i=0;i<=4;i++){
    var y=pad.top+cH-(i/4)*cH;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+cW,y);ctx.stroke();
    ctx.fillStyle='#7a7870';ctx.font='10px monospace';ctx.textAlign='right';
    ctx.fillText('€'+(maxVal*i/4).toFixed(0),pad.left-6,y+3);
  }
  var grad=ctx.createLinearGradient(0,pad.top,0,pad.top+cH);
  grad.addColorStop(0,'rgba(232,201,122,0.3)');grad.addColorStop(1,'rgba(232,201,122,0)');
  ctx.beginPath();
  data.forEach(function(val,idx){
    var x=pad.left+(idx/(data.length-1||1))*cW;
    var y=pad.top+cH-(val/maxVal)*cH;
    idx===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.strokeStyle='#e8c97a';ctx.lineWidth=2;ctx.stroke();
  ctx.lineTo(pad.left+cW,pad.top+cH);ctx.lineTo(pad.left,pad.top+cH);ctx.closePath();
  ctx.fillStyle=grad;ctx.fill();
  data.forEach(function(val,idx){
    var x=pad.left+(idx/(data.length-1||1))*cW;
    var y=pad.top+cH-(val/maxVal)*cH;
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#e8c97a';ctx.fill();
    ctx.fillStyle='#7a7870';ctx.font='9px monospace';ctx.textAlign='center';
    ctx.fillText(labels[idx],x,h-6);
  });
  grafiekData.maxVal=maxVal;

  // Mouse hover
  canvas.onmousemove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    var my=(e.clientY-rect.top)*(canvas.height/rect.height);
    var tooltip=document.getElementById('grafiek-tooltip');
    var closestIdx=-1, closestDist=999;
    data.forEach(function(val,idx){
      var x=pad.left+(idx/(data.length-1||1))*cW;
      var dist=Math.abs(mx-x);
      if(dist<closestDist){closestDist=dist;closestIdx=idx;}
    });
    if(closestIdx>=0&&closestDist<30){
      var px=pad.left+(closestIdx/(data.length-1||1))*cW;
      var py=pad.top+cH-(data[closestIdx]/maxVal)*cH;
      var canvasRect=canvas.getBoundingClientRect();
      var parentRect=canvas.parentElement.getBoundingClientRect();
      tooltip.style.display='block';
      tooltip.style.left=(px*(canvasRect.width/canvas.width)-40)+'px';
      tooltip.style.top=(py*(canvasRect.height/canvas.height)-44)+'px';
      tooltip.innerHTML='<div style="font-size:0.65rem;color:var(--muted);">'+labels[closestIdx]+'</div><div style="font-size:0.88rem;color:var(--accent);font-weight:500;">&euro; '+data[closestIdx].toFixed(2)+'</div>';
    } else {
      tooltip.style.display='none';
    }
  };
  canvas.onmouseleave=function(){ document.getElementById('grafiek-tooltip').style.display='none'; };
}

function renderStatistieken() {
  var ds=statGeselecteerdeDag||(statPeriode==='dag'?datumNaarStr(statAnker):null);
  var boek=[];
  if(statPeriode==='dag'||(ds&&(statPeriode==='week'||statPeriode==='maand'))) {
    boek=boekingen.filter(function(b){return b.datumStr===(ds||datumNaarStr(statAnker));});
  } else if(statPeriode==='week') {
    var ma=getMaandagVanWeek(statAnker),zo=new Date(ma);zo.setDate(zo.getDate()+6);
    boek=boekingen.filter(function(b){var d=strNaarDatum(b.datumStr);return d>=ma&&d<=zo;});
  } else if(statPeriode==='maand') {
    boek=boekingen.filter(function(b){var d=strNaarDatum(b.datumStr);return d.getMonth()===statAnker.getMonth()&&d.getFullYear()===statAnker.getFullYear();});
  } else if(statPeriode==='jaar') {
    boek=boekingen.filter(function(b){return strNaarDatum(b.datumStr).getFullYear()===statAnker.getFullYear();});
  }
  var totaal=boek.length;
  var betaald=boek.filter(function(b){return b.betaling==='betaald';});
  var achteraf=boek.filter(function(b){return b.betaling==='achteraf';});
  var totaalBetaald=betaald.reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0);
  var totaalOpenstaand=achteraf.reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0);
  var alleOpenstaand=boekingen.filter(function(b){return b.betaling==='achteraf';});
  var totaalAlleOpenstaand=alleOpenstaand.reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0);
  var gemiddeld=betaald.length>0?(totaalBetaald/betaald.length).toFixed(2):'0.00';
  var periodeLabel='';
  if(statPeriode==='dag') periodeLabel=datumNaarStr(statAnker)===datumNaarStr(new Date())?'Vandaag':datumNaarStr(statAnker);
  else if(statPeriode==='week'){var ma2=getMaandagVanWeek(statAnker),zo2=new Date(ma2);zo2.setDate(zo2.getDate()+6);periodeLabel=ds||('Week: '+ma2.getDate()+' – '+zo2.getDate()+' '+MAANDEN[zo2.getMonth()]);}
  else if(statPeriode==='maand') periodeLabel=ds||(MAANDEN[statAnker.getMonth()].charAt(0).toUpperCase()+MAANDEN[statAnker.getMonth()].slice(1)+' '+statAnker.getFullYear());
  else periodeLabel=statAnker.getFullYear().toString();
  document.getElementById('stat-periode-label').textContent=periodeLabel;
  document.getElementById('stat-grid').innerHTML=
    '<div class="stat-kaart"><div class="stat-label">Boekingen</div><div class="stat-waarde">'+totaal+'</div><div class="stat-sub">'+betaald.length+' betaald &middot; '+achteraf.length+' achteraf</div></div>'+
    '<div class="stat-kaart"><div class="stat-label">Ontvangen</div><div class="stat-waarde">&euro; '+totaalBetaald.toFixed(2)+'</div><div class="stat-sub">'+betaald.length+' betalingen</div></div>'+
    '<div class="stat-kaart"><div class="stat-label">Gemiddeld</div><div class="stat-waarde">&euro; '+gemiddeld+'</div><div class="stat-sub">per betaalde boeking</div></div>'+
    '<div class="stat-kaart"><div class="stat-label">Openstaand</div><div class="stat-waarde" style="color:#f4a0b8;">&euro; '+totaalOpenstaand.toFixed(2)+'</div><div class="stat-sub">'+achteraf.length+' achteraf</div></div>';
  renderStatSelector();
  var grafLabels=[],grafData=[];
  if(statPeriode==='dag'){
    for(var u=9;u<=23;u++){grafLabels.push(String(u).padStart(2,'0')+'u');grafData.push(boek.filter(function(b){return b.betaling==='betaald'&&Math.floor(b.start/60)===u;}).reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0));}
    document.getElementById('stat-grafiek-titel').textContent='Inkomsten per uur';
  } else if(statPeriode==='week'){
    var ma3=getMaandagVanWeek(statAnker);
    for(var j=0;j<7;j++){var dd=new Date(ma3);dd.setDate(dd.getDate()+j);var dds=datumNaarStr(dd);grafLabels.push(['Ma','Di','Wo','Do','Vr','Za','Zo'][dd.getDay()===0?6:dd.getDay()-1]);grafData.push(boekingen.filter(function(b){return b.datumStr===dds&&b.betaling==='betaald';}).reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0));}
    document.getElementById('stat-grafiek-titel').textContent='Inkomsten per dag deze week';
  } else if(statPeriode==='maand'){
    var jaar2=statAnker.getFullYear(),mnd2=statAnker.getMonth(),dim=new Date(jaar2,mnd2+1,0).getDate();
    for(var dag=1;dag<=dim;dag++){var dss=jaar2+'-'+String(mnd2+1).padStart(2,'0')+'-'+String(dag).padStart(2,'0');grafLabels.push(String(dag));grafData.push(boekingen.filter(function(b){return b.datumStr===dss&&b.betaling==='betaald';}).reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0));}
    document.getElementById('stat-grafiek-titel').textContent='Inkomsten per dag deze maand';
  } else {
    for(var m=0;m<12;m++){grafLabels.push(MAANDEN[m].slice(0,3));grafData.push(boekingen.filter(function(b){var d2=strNaarDatum(b.datumStr);return d2.getMonth()===m&&d2.getFullYear()===statAnker.getFullYear()&&b.betaling==='betaald';}).reduce(function(s,b){return s+((b.prijs == null ? 10 : b.prijs));},0));}
    document.getElementById('stat-grafiek-titel').textContent='Inkomsten per maand dit jaar';
  }
  setTimeout(function(){renderGrafiek(grafLabels,grafData);},50);
  var platforms=Object.create(null);
  boek.forEach(function(b){ var p=b.platform||'overig'; platforms[p]=(platforms[p]||0)+1; });
  var platArr=Object.keys(platforms).sort(function(a,b){return platforms[b]-platforms[a];});
  var platHtml='<div class="stat-sectie-titel">&#127942; Platforms</div>';
  if(!platArr.length)platHtml+='<p style="font-size:0.75rem;color:var(--muted);margin-top:8px;">Geen data</p>';
  else platArr.forEach(function(p){platHtml+='<div class="platform-rij"><span class="platform-naam">'+escHtml(p)+'</span><span class="platform-count">'+platforms[p]+'x</span></div>';});
  document.getElementById('stat-platforms').innerHTML=platHtml;
  document.getElementById('stat-openstaand').innerHTML='<div class="stat-sectie-titel">&#128176; Totaal openstaand</div><div class="openstaand-bedrag">&euro; '+totaalAlleOpenstaand.toFixed(2)+'</div><div class="openstaand-count" style="color:var(--muted);font-size:0.72rem;">'+alleOpenstaand.length+' boeking(en) &mdash; <span style="color:var(--accent);text-decoration:underline;cursor:pointer;" onclick="toonOpenstaandLijst()">bekijk lijst</span></div>';
}

function toonOpenstaandLijst() {
  var alleOpenstaand = boekingen.filter(function(b){ return b.betaling==='achteraf'; });
  alleOpenstaand.sort(function(a,b){ return strNaarDatum(a.datumStr)-strNaarDatum(b.datumStr); });
  var lijst = document.getElementById('stat-openstaand-items');
  if (!alleOpenstaand.length) {
    lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:12px 0;">Geen openstaande betalingen</p>';
  } else {
    lijst.innerHTML = alleOpenstaand.map(function(b) {
      return '<div class="openstaand-item" onclick="naarOpenstaandBoeking(\''+b.datumStr+'\','+b.start+','+(b.tijdvak||0)+')">' +
        '<div class="openstaand-item-links">' +
        '<div class="openstaand-item-naam">'+escHtml(b.naam)+'</div>' +
        '<div class="openstaand-item-info">'+b.datumStr+' &middot; '+minNaarTijd(b.start)+' &ndash; '+minNaarTijd(b.eind)+'</div>' +
        '</div>' +
        '<div class="openstaand-item-bedrag">&euro; '+((b.prijs == null ? 10 : b.prijs)).toFixed(2)+'</div>' +
        '</div>';
    }).join('');
  }
  document.getElementById('stat-openstaand-lijst').style.display = 'block';
  document.getElementById('stat-openstaand-lijst').scrollIntoView({behavior:'smooth'});
}

function naarOpenstaandBoeking(datumStr, start, tijdvak) {
  naarDag(datumStr);
  toonPagina('schema');
}

function openStatistieken() {
  statAnker=new Date(); statGeselecteerdeDag=null;
  toonPagina('statistieken'); renderStatistieken();
}


/* ===== PATHÉ FILMS ===== */
function openPathe() {
  toonPagina('pathe');
  var vandaag = datumNaarStr(new Date());
  document.getElementById('pathe-datum').value = vandaag;
  toonTijdsloten(vandaag);
  document.getElementById('pathe-resultaten').innerHTML = '';
}

function toonTijdsloten(datumStr) {
  var dagBoek = boekingen.filter(function(b){ return b.datumStr === datumStr; });
  dagBoek.sort(function(a,b){ return a.start - b.start; });
  var container = document.getElementById('pathe-tijdsloten');
  if (!dagBoek.length) {
    container.innerHTML = '<div style="font-size:0.72rem;color:var(--muted);">Geen boekingen op deze dag — hele dag vrij.</div>';
    return;
  }
  var html = '<div style="font-size:0.65rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;">Vrije tijdsloten</div>';
  var eersteStart = dagBoek[0].start;
  if (eersteStart > OPEN + 60) {
    html += '<span class="pathe-tijdslot">Voor boekingen: <strong>' + minNaarTijd(OPEN) + ' – ' + minNaarTijd(eersteStart - MIN_GAP) + '</strong></span>';
  }
  var laatsteEind = dagBoek[dagBoek.length-1].eind;
  html += '<span class="pathe-tijdslot">Na boekingen: <strong>' + minNaarTijd(laatsteEind + MIN_GAP) + ' – middernacht</strong></span>';
  container.innerHTML = html;
}

function zoekPatheFilms() {
  var datum = document.getElementById('pathe-datum').value;
  var vestiging = document.getElementById('pathe-vestiging').value.trim() || 'Nederland';
  var resultaten = document.getElementById('pathe-resultaten');
  if (!datum) { alert('Kies een datum.'); return; }
  toonTijdsloten(datum);

  var dagBoek = boekingen.filter(function(b){ return b.datumStr === datum; });
  dagBoek.sort(function(a,b){ return a.start - b.start; });

  var vrijVoor = '', vrijNa = '';
  if (dagBoek.length) {
    var eersteStart = dagBoek[0].start;
    var laatsteEind = dagBoek[dagBoek.length-1].eind;
    if (eersteStart > OPEN + 60) vrijVoor = minNaarTijd(OPEN) + ' tot ' + minNaarTijd(eersteStart - MIN_GAP);
    vrijNa = minNaarTijd(laatsteEind + MIN_GAP) + ' tot middernacht';
  } else {
    vrijNa = '09:00 tot middernacht';
  }

  var d = new Date(datum);
  var datumLeesbaar = d.getDate() + ' ' + MAANDEN[d.getMonth()] + ' ' + d.getFullYear();
  resultaten.innerHTML = '<div class="pathe-laden"><span class="loader"></span> Films zoeken bij Path\u00e9 ' + escHtml(vestiging) + ' voor ' + datumLeesbaar + '...</div>';

  var filmNaam = document.getElementById('pathe-film').value.trim();

  beveiligdeFetch('/.netlify/functions/pathe', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({datum: datum, vestiging: vestiging, vrijVoor: vrijVoor, vrijNa: vrijNa, filmNaam: filmNaam})
  })
  .then(function(r){
    if (r.status === 429) return r.json().then(function(d){ throw new Error(d.error || 'Te veel verzoeken, wacht even.'); });
    if (!r.ok) return r.text().then(function(t){ throw new Error('Server fout ' + r.status + ': ' + t); });
    return r.json();
  })
  .then(function(data) {
    if (data.waarschuwing) {
      resultaten.innerHTML = '<div class="form-card"><div class="stat-sectie-titel" style="color:var(--accent);">&#128197; Datum te ver vooruit</div><p style="font-size:0.78rem;color:var(--muted);line-height:1.7;margin-top:8px;">' + escHtml(data.waarschuwing) + '</p></div>';
      return;
    }
    var films = data.films || [];
    if (data.error) {
      resultaten.innerHTML = '<div class="form-card"><div class="stat-sectie-titel" style="color:var(--error);">&#9888; Fout</div><p style="font-size:0.75rem;color:var(--muted);">' + escHtml(data.error) + '</p></div>';
      return;
    }
    if (!films.length) {
      resultaten.innerHTML = '<div class="pathe-laden">Geen passende films gevonden voor jouw vrije tijdsloten.<br><br><a href="https://www.pathe.nl/films" target="_blank" style="color:var(--accent);">&#8599; Bekijk alle films op Path\u00e9.nl</a></div>';
      return;
    }
    var html = '<div style="font-size:0.65rem;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em;">' + films.length + ' film(s) gevonden die passen bij jouw schema</div>';
    films.forEach(function(f) {
      html += '<div class="pathe-film-kaart">' +
        '<div class="pathe-film-titel">' + escHtml(f.titel||'') + '</div>' +
        '<div class="pathe-film-info">' +
          (f.genre ? escHtml(f.genre) + ' &middot; ' : '') +
          (f.duur ? escHtml(f.duur) + ' &middot; ' : '') +
          escHtml(f.vestiging || vestiging) + ' &middot; ' +
          '<span style="color:' + (f.slot==='voor' ? 'var(--blue)' : 'var(--success)') + ';">' +
          (f.slot==='voor' ? 'V\u00f3\u00f3r boekingen' : 'Na boekingen') + '</span>' +
        '</div>' +
        '<div class="pathe-tijden">' +
          (f.tijden||[]).map(function(t){ return '<span class="pathe-tijd-chip">' + escHtml(t) + '</span>'; }).join('') +
        '</div>' +
        (f.pathe_url ? '<div style="margin-top:10px;"><a href="' + f.pathe_url + '" target="_blank" style="font-size:0.68rem;color:var(--accent);text-decoration:none;">&#8599; Bekijk op Path\u00e9</a></div>' : '') +
        '</div>';
    });
    resultaten.innerHTML = html;
  })
  .catch(function(err) {
    resultaten.innerHTML = '<div class="form-card">' +
      '<div class="stat-sectie-titel" style="color:var(--error);">&#9888; Verbindingsfout</div>' +
      '<p style="font-size:0.75rem;color:var(--muted);margin-bottom:12px;">' + escHtml(err.message || 'Onbekende fout') + '</p>' +
      '<a href="https://www.pathe.nl/films" target="_blank" class="add-btn" style="text-decoration:none;text-align:center;display:block;">&#8599; Open Path\u00e9.nl direct</a>' +
      '</div>';
  });
}

var meldingen = [];
var meldingInterval = null;
var MELDING_RICHTING = 'na';  // 'voor' of 'na' de boeking
var MELDING_MINUTEN = 15;     // minuten voor/na de boeking
var PUSH_NIEUWS = true;
var PUSH_ACHTERAF = true;

function checkMeldingen() {
  var nu = new Date();
  var nuMin = nu.getHours() * 60 + nu.getMinutes();
  var vandaag = datumNaarStr(nu);
  var nieuw = [];

  boekingen.forEach(function(b) {
    if (b.betaling !== 'achteraf') return;
    // Melding op instelbaar tijdstip voor/na boeking
    var meldingTijd = MELDING_RICHTING === 'voor' ? b.start - MELDING_MINUTEN : b.start + MELDING_MINUTEN;
    if (b.datumStr === vandaag && nuMin >= meldingTijd) {
      var key = b.datumStr + '_' + b.start + '_tv' + (b.tijdvak || 0);
      var gezien = JSON.parse(localStorage.getItem('meldingen_gezien_' + huidigeGebruiker) || '[]');
      if (gezien.indexOf(key) === -1) {
        nieuw.push({
          key: key,
          naam: b.naam,
          datumStr: b.datumStr,
          start: b.start,
          tijdvak: b.tijdvak || 0,
          tekst: '"' + b.naam + '" - gestart om ' + minNaarTijd(b.start) + ', nog niet betaald'
        });
      }
    }
  });

  meldingen = nieuw;
  updateBelIcoon();
}

function updateBelIcoon() {
  var stip = document.getElementById('bel-stip');
  var btn = document.getElementById('bel-btn');
  var heeftMeldingen = meldingen.length > 0;
  if (stip) stip.style.display = heeftMeldingen ? 'block' : 'none';
  if (btn) btn.classList.toggle('heeft-meldingen', heeftMeldingen);
  // Sync sub-pagina stipjes
  ['bel-stip-profiel','bel-stip-inst','bel-stip-stat','bel-stip-pathe','bel-stip-nieuws'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = heeftMeldingen ? 'block' : 'none';
  });
  ['bel-btn-profiel','bel-btn-inst','bel-btn-stat','bel-btn-pathe','bel-btn-nieuws'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('heeft-meldingen', heeftMeldingen);
  });
  renderMeldingLijst();
}

function renderMeldingLijst() {
  var lijst = document.getElementById('melding-lijst');
  if (!lijst) return;
  if (meldingen.length === 0) {
    lijst.innerHTML = '<div class="melding-leeg">Geen meldingen</div>';
    return;
  }
  lijst.innerHTML = meldingen.map(function(m, idx) {
    if (m.type === 'update') {
      return '<div class="melding-notif" onclick="klikUpdateMelding()">' +
        '<div class="melding-notif-links">' +
        '<div class="melding-notif-stip" style="background:var(--accent);"></div>' +
        '<div><div class="melding-notif-tekst">&#128240; ' + escHtml(m.tekst) + '</div>' +
        '<div class="melding-notif-tijd">Nieuws &amp; Updates</div></div></div>' +
        '<span class="melding-notif-pijl">&#8594;</span></div>';
    }
    return '<div class="melding-notif" onclick="naarMelding(\'' + m.datumStr + '\',' + m.start + ',' + (m.tijdvak||0) + ')">' +
      '<div class="melding-notif-links">' +
      '<div class="melding-notif-stip"></div>' +
      '<div><div class="melding-notif-tekst">' + escHtml(m.tekst) + '</div>' +
      '<div class="melding-notif-tijd">Betaling openstaand</div></div></div>' +
      '<span class="melding-notif-pijl">&#8594;</span></div>';
  }).join('');
}

function klikUpdateMelding() {
  document.getElementById('melding-bar').classList.remove('open');
  openNieuwsPagina();
}

function naarMelding(datumStr, start, tijdvak) {
  // Markeer als gezien
  var gezien = JSON.parse(localStorage.getItem('meldingen_gezien_' + huidigeGebruiker) || '[]');
  var key = datumStr + '_' + start + '_tv' + (tijdvak || 0);
  if (gezien.indexOf(key) === -1) gezien.push(key);
  localStorage.setItem('meldingen_gezien_' + huidigeGebruiker, JSON.stringify(gezien));
  // Sluit melding bar
  document.getElementById('melding-bar').classList.remove('open');
  // Ga naar dagschema
  naarDag(datumStr);
  // Verwijder uit meldingen
  meldingen = meldingen.filter(function(m){ return m.key !== key; });
  updateBelIcoon();
}

function startMeldingTimer() {
  if (meldingInterval) clearInterval(meldingInterval);
  checkMeldingen();
  meldingInterval = setInterval(checkMeldingen, 60000); // elke minuut checken
}

function togglePushVoorkeur(type) {
  if (type === 'nieuws') {
    PUSH_NIEUWS = !PUSH_NIEUWS;
    var el = document.getElementById('toggle-push-nieuws');
    if (el) el.classList.toggle('aan', PUSH_NIEUWS);
  } else {
    PUSH_ACHTERAF = !PUSH_ACHTERAF;
    var el = document.getElementById('toggle-push-achteraf');
    if (el) el.classList.toggle('aan', PUSH_ACHTERAF);
  }
}

function slaMeldingenInstellingenOp() {
  var richting = document.getElementById('inst-melding-richting').value;
  var minuten = parseInt(document.getElementById('inst-melding-minuten').value);
  if (isNaN(minuten) || minuten < 0) minuten = 0;
  MELDING_RICHTING = richting;
  MELDING_MINUTEN = minuten;
  var updates = {
    meldingRichting: richting,
    meldingMinuten: minuten,
    pushNieuws: PUSH_NIEUWS,
    pushAchteraf: PUSH_ACHTERAF
  };
  db.collection('instellingen').doc(huidigeGebruiker).set(updates, {merge:true}).then(function() {
    // Update ook de push-abonnement voorkeur in Firestore
    db.collection('pushSubscriptions').doc(huidigeGebruiker).update({
      pushNieuws: PUSH_NIEUWS,
      pushAchteraf: PUSH_ACHTERAF
    }).catch(function(){});
    checkMeldingen();
    voegLogToe('Meldingsinstellingen opgeslagen.', 'success');
    toonPagina('schema');
    renderOverzicht();
  }).catch(function(e) { alert('Fout: ' + e.message); });
}

/* ===== TOP SELLER ===== */
var tsContext = 'admin'; // 'admin' of 'beheer'
var tsPeriode = 'week';  // 'dag', 'week', 'maand'

function getTopSellerContainerId() {
  if (tsContext === 'admin') return 'admin-topseller-inhoud';
  if (tsContext === 'beheer') return 'beheer-topseller-inhoud';
  return 'ranglijst-inhoud';
}

function renderTopSeller(context) {
  tsContext = context;
  var el = document.getElementById(getTopSellerContainerId());
  el.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:24px 0;">Laden...</p>';
  _laadEnToonTopSeller();
}

function openRanglijst() {
  if (!authProfiel || !abonnementStatus || !abonnementStatus.allowed) return;
  toonPagina('ranglijst');
  renderTopSeller('gebruiker');
}

function _laadEnToonTopSeller() {
  if (tsContext === 'gebruiker') return laadPubliekeRanglijst();
  Promise.all([
    db.collection('accounts').get(),
    db.collection('boekingen').get()
  ]).then(function(results) {
    var accounts = {};
    results[0].docs.forEach(function(d){ accounts[d.id] = d.data(); });
    var alleBoekingen = results[1].docs.map(function(d){ return d.data(); });

    // Bepaal periode filter voor stats
    var vandaag = new Date();
    var filterFn;
    if (tsPeriode === 'dag') {
      var vandaagStr = datumNaarStr(vandaag);
      filterFn = function(b){ return b.datumStr === vandaagStr; };
    } else if (tsPeriode === 'week') {
      var ma = new Date(vandaag);
      var dagNr = vandaag.getDay(); var diff = (dagNr===0?-6:1-dagNr);
      ma.setDate(vandaag.getDate()+diff); ma.setHours(0,0,0,0);
      var zo = new Date(ma); zo.setDate(ma.getDate()+6); zo.setHours(23,59,59,999);
      filterFn = function(b){
        if (!b.datumStr) return false;
        var d = strNaarDatum(b.datumStr); return d >= ma && d <= zo;
      };
    } else {
      var mStart = new Date(vandaag.getFullYear(), vandaag.getMonth(), 1);
      var mEind = new Date(vandaag.getFullYear(), vandaag.getMonth()+1, 0);
      filterFn = function(b){
        if (!b.datumStr) return false;
        var d = strNaarDatum(b.datumStr); return d >= mStart && d <= mEind;
      };
    }

    // "Actief deze week" filter: boeking in afgelopen 7 dagen
    var zevenDagenGeleden = new Date(vandaag); zevenDagenGeleden.setDate(vandaag.getDate()-7); zevenDagenGeleden.setHours(0,0,0,0);
    function actielDezeWeek(u) {
      return alleBoekingen.some(function(b){
        if (b.gebruiker !== u || !b.datumStr) return false;
        return strNaarDatum(b.datumStr) >= zevenDagenGeleden;
      });
    }
    function heeftOoitGeboekt(u) {
      return alleBoekingen.some(function(b){ return b.gebruiker === u; });
    }

    // Groepeer stats per gebruiker voor geselecteerde periode
    var stats = {};
    Object.keys(accounts).forEach(function(u){ stats[u] = {gebruiker:u, boekingen:0, verdienst:0}; });
    alleBoekingen.filter(filterFn).forEach(function(b){
      var u = b.gebruiker; if (!u) return;
      if (!stats[u]) stats[u] = {gebruiker:u, boekingen:0, verdienst:0};
      stats[u].boekingen++;
      stats[u].verdienst += parseFloat(b.prijs)||0;
    });

    // Splits: gekwalificeerd = actief afgelopen 7 dagen
    // Privé-gebruikers: bij gebruikerscontext verbergen, bij admin/beheer tonen met label
    var alleStats = Object.values(stats);
    var gekwalificeerd = [], niKwali = [], prive = [];

    alleStats.forEach(function(s) {
      var acc = accounts[s.gebruiker] || {};
      var isActief = actielDezeWeek(s.gebruiker);
      var heeftOoit = heeftOoitGeboekt(s.gebruiker);
      var isPrive = !!acc.ranglijstPrive;

      if (isPrive && tsContext === 'gebruiker') {
        prive.push(s); // verborgen voor andere gebruikers
      } else if (isActief && heeftOoit) {
        s.isPrive = isPrive;
        gekwalificeerd.push(s);
      } else {
        niKwali.push(s);
      }
    });

    // Rangschikken
    if (gekwalificeerd.length > 0) {
      // Privé-gebruikers niet meenemen in ranking zichtbaar voor anderen (maar wel tonen voor admin)
      var teRanken = tsContext === 'gebruiker'
        ? gekwalificeerd
        : gekwalificeerd;
      var gesortBoek = teRanken.slice().sort(function(a,b){ return b.boekingen-a.boekingen; });
      var gesortVerd = teRanken.slice().sort(function(a,b){ return b.verdienst-a.verdienst; });
      teRanken.forEach(function(s){
        s.rankBoek = gesortBoek.findIndex(function(x){ return x.gebruiker===s.gebruiker; })+1;
        s.rankVerd = gesortVerd.findIndex(function(x){ return x.gebruiker===s.gebruiker; })+1;
        s.gemRank = (s.rankBoek + s.rankVerd) / 2;
      });
      teRanken.sort(function(a,b){ return a.gemRank - b.gemRank; });
    }

    // Helper: avatar HTML
    function avatarHtml(s, size, kleur) {
      var acc = accounts[s.gebruiker] || {};
      if (veiligeFoto(acc.foto)) {
        return '<img src="'+veiligeFoto(acc.foto)+'" style="width:'+size+'px;height:'+size+'px;border-radius:50%;object-fit:cover;flex-shrink:0;" />';
      }
      return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:'+kleur+';color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:'+(size*0.4)+'px;font-weight:700;flex-shrink:0;">'+s.gebruiker.charAt(0).toUpperCase()+'</div>';
    }

    // Renderen
    var periodeLabel = tsPeriode==='dag' ? 'Vandaag' : tsPeriode==='week' ? 'Deze week' : 'Deze maand';
    var medailles = ['🥇','🥈','🥉'];
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px;">'
      + '<div style="font-size:0.65rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">🏆 Ranglijst &middot; '+periodeLabel+'</div>'
      + '<div class="view-tabs">'
      + '<button class="view-tab'+(tsPeriode==='dag'?' active':'')+'" onclick="tsSetPeriode(\'dag\')">Dag</button>'
      + '<button class="view-tab'+(tsPeriode==='week'?' active':'')+'" onclick="tsSetPeriode(\'week\')">Week</button>'
      + '<button class="view-tab'+(tsPeriode==='maand'?' active':'')+'" onclick="tsSetPeriode(\'maand\')">Maand</button>'
      + '</div></div>';

    if (gekwalificeerd.length === 0) {
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;color:var(--muted);font-size:0.75rem;">Nog niemand actief genoeg om in de ranglijst te staan.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">';
      gekwalificeerd.forEach(function(s, i) {
        var medal = medailles[i] || ('#'+(i+1));
        var acc = accounts[s.gebruiker] || {};
        var topBoek = s.rankBoek === 1, topVerd = s.rankVerd === 1;
        var isIk = tsContext === 'gebruiker' && s.gebruiker === huidigeGebruiker;
        var borderKleur = i===0 ? 'var(--accent)' : isIk ? 'var(--accent2)' : 'var(--border)';
        var avatarKleur = isIk ? 'var(--accent2)' : 'var(--accent)';
        html += '<div style="background:var(--surface2);border:2px solid '+borderKleur+';border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:14px;position:relative;'+(i===0?'box-shadow:0 0 12px rgba(200,170,110,0.15);':'')+';">'
          + (isIk ? '<div style="position:absolute;top:-1px;right:10px;font-size:0.55rem;background:var(--accent2);color:var(--bg);border-radius:0 0 6px 6px;padding:2px 7px;letter-spacing:0.08em;text-transform:uppercase;">Jij</div>' : '')
          + (s.isPrive && tsContext !== 'gebruiker' ? '<div style="position:absolute;top:-1px;left:10px;font-size:0.55rem;background:var(--muted);color:var(--bg);border-radius:0 0 6px 6px;padding:2px 7px;letter-spacing:0.08em;">🔒 privé</div>' : '')
          + '<div style="font-size:'+(i<3?'1.4rem':'0.9rem')+';min-width:28px;text-align:center;font-weight:700;color:'+(i===0?'var(--accent)':'var(--muted)')+';">'+medal+'</div>'
          + avatarHtml(s, 38, avatarKleur)
          + '<div style="flex:1;min-width:0;">'
          +   '<div style="font-size:0.82rem;font-weight:600;color:var(--text);">@'+escHtml(s.gebruiker)+'</div>'
          +   (tsContext !== 'gebruiker' ? '<div style="font-size:0.65rem;color:var(--muted);">'+escHtml(acc.email||'')+'</div>' : '')
          + '</div>'
          + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">'
          +   '<div style="font-size:0.72rem;color:'+(topBoek?'var(--accent)':'var(--text)')+';">📅 '+s.boekingen+(topBoek?' 🏆':'')+'</div>'
          +   '<div style="font-size:0.72rem;color:'+(topVerd?'var(--accent)':'var(--text)')+';">💶 €'+s.verdienst.toFixed(2)+(topVerd?' 🏆':'')+'</div>'
          + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // Niet actief / 0 boekingen ooit
    if (niKwali.length > 0) {
      niKwali.sort(function(a,b){ return b.boekingen - a.boekingen; });
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden;opacity:0.65;margin-bottom:12px;">'
        + '<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:0.6rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">Nog niet actief genoeg</div>';
      niKwali.forEach(function(s) {
        var acc = accounts[s.gebruiker] || {};
        var isIk = tsContext === 'gebruiker' && s.gebruiker === huidigeGebruiker;
        html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);background:'+(isIk?'rgba(255,255,255,0.03)':'')+';">'
          + avatarHtml(s, 32, 'var(--border)')
          + '<div style="flex:1;font-size:0.78rem;color:var(--muted);">@'+escHtml(s.gebruiker)+(isIk?' <span style="font-size:0.6rem;background:var(--accent2);color:var(--bg);border-radius:4px;padding:1px 5px;">jij</span>':'')+'</div>'
          + '<div style="font-size:0.68rem;color:var(--muted);">'+(heeftOoitGeboekt(s.gebruiker)?'Niet actief deze week':'Nog geen boekingen')+'</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // Privé-gebruikers (alleen voor gebruikerscontext — anderen zien ze niet)
    if (prive.length > 0 && tsContext === 'gebruiker') {
      // Alleen de eigen gebruiker ziet zichzelf als privé
      var eigenPrive = prive.filter(function(s){ return s.gebruiker === huidigeGebruiker; });
      if (eigenPrive.length > 0) {
        html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden;opacity:0.65;">'
          + '<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:0.6rem;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;">🔒 Niet zichtbaar voor anderen</div>'
          + '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;">'
          + avatarHtml(eigenPrive[0], 32, 'var(--border)')
          + '<div style="flex:1;font-size:0.78rem;color:var(--muted);">@'+escHtml(eigenPrive[0].gebruiker)+' <span style="font-size:0.6rem;background:var(--accent2);color:var(--bg);border-radius:4px;padding:1px 5px;">jij</span></div>'
          + '<div style="font-size:0.68rem;color:var(--muted);">Profiel staat op privé</div>'
          + '</div></div>';
      }
    }

    document.getElementById(getTopSellerContainerId()).innerHTML = html;
  }).catch(function(e){
    document.getElementById(getTopSellerContainerId()).innerHTML = '<p style="color:var(--error);font-size:0.75rem;text-align:center;padding:16px;">Fout bij laden: '+e.message+'</p>';
  });
}

function tsSetPeriode(p) {
  tsPeriode = p;
  _laadEnToonTopSeller();
}

/* ===== NIEUWS & UPDATES SYSTEEM ===== */

function formaatDatum(ts) {
  if (!ts) return '';
  var d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  var mnd = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  return d.getDate() + ' ' + mnd[d.getMonth()] + ' ' + d.getFullYear();
}

function openNieuwsPagina() {
  toonPagina('nieuws');
  nieuwsTabWissel('updates');
}

function nieuwsTabWissel(tab) {
  document.getElementById('nieuws-sectie-updates').style.display = tab==='updates' ? '' : 'none';
  document.getElementById('nieuws-sectie-meldingen').style.display = tab==='meldingen' ? '' : 'none';
  document.getElementById('nieuws-tab-updates').classList.toggle('active', tab==='updates');
  document.getElementById('nieuws-tab-meldingen').classList.toggle('active', tab==='meldingen');
  if (tab==='updates') laadEnToonUpdates();
  if (tab==='meldingen') laadEnToonMeldingen();
}

function laadEnToonUpdates() {
  var lijst = document.getElementById('nieuws-updates-lijst');
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:24px 0;">Laden...</p>';
  db.collection('updates').orderBy('aangemaakt', 'desc').get().then(function(snap) {
    if (snap.empty) {
      lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:24px 0;">Nog geen updates geplaatst.</p>';
      return;
    }
    // Haal gelezen IDs op en markeer alle updates als gelezen
    db.collection('accounts').doc(huidigeGebruiker).get().then(function(doc) {
      var gelezen = doc.exists && doc.data().gelezenUpdates ? doc.data().gelezenUpdates : [];
      var alleIds = snap.docs.map(function(d){ return d.id; });
      var nieuweGelezen = gelezen.slice();
      alleIds.forEach(function(id){ if (nieuweGelezen.indexOf(id) === -1) nieuweGelezen.push(id); });
      db.collection('accounts').doc(huidigeGebruiker).update({gelezenUpdates: nieuweGelezen}).catch(function(){});
      // Verwijder update notificatie uit bell systeem
      meldingen = meldingen.filter(function(m){ return m.type !== 'update'; });
      updateBelIcoon();

      lijst.innerHTML = snap.docs.map(function(d) {
        var u = d.data();
        var isNieuw = gelezen.indexOf(d.id) === -1;
        return '<div class="form-card" style="margin-bottom:12px;">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px;">' +
          '<div class="form-title" style="margin-bottom:0;">' + escHtml(u.titel || '') + '</div>' +
          (isNieuw ? '<span style="font-size:0.6rem;background:var(--accent);color:var(--bg);border-radius:4px;padding:2px 7px;letter-spacing:0.06em;white-space:nowrap;flex-shrink:0;">Nieuw</span>' : '') +
          '</div>' +
          '<div style="font-size:0.82rem;color:var(--text);line-height:1.7;margin-bottom:10px;white-space:pre-wrap;">' + escHtml(u.inhoud || '') + '</div>' +
          '<div style="font-size:0.62rem;color:var(--muted);">' + formaatDatum(u.aangemaakt) + '</div>' +
          '</div>';
      }).join('');
    });
  }).catch(function(e) {
    lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--error);text-align:center;padding:16px;">Fout bij laden: ' + e.message + '</p>';
  });
}

function laadEnToonMeldingen() {
  var lijst = document.getElementById('nieuws-meldingen-lijst');
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:24px 0;">Laden...</p>';
  db.collection('meldingen').orderBy('datum', 'desc').get().then(function(snap) {
    if (snap.empty) {
      lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:24px 0;">Nog geen meldingen ingediend.</p>';
      return;
    }
    lijst.innerHTML = snap.docs.map(function(d) {
      return renderMeldingKaart(d.id, d.data(), false);
    }).join('');
  }).catch(function(e) {
    lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--error);text-align:center;padding:16px;">Fout bij laden: ' + e.message + '</p>';
  });
}

function renderMeldingKaart(docId, m, isAdmin) {
  var stemmen = m.stemmen || {};
  var voorCount = Object.values(stemmen).filter(function(v){ return v==='voor'; }).length;
  var tegenCount = Object.values(stemmen).filter(function(v){ return v==='tegen'; }).length;
  var eigenStem = stemmen[huidigeGebruiker] || null;
  var isEigen = m.gebruiker === huidigeGebruiker;
  var stemDisabled = isEigen ? 'opacity:0.4;cursor:not-allowed;' : '';
  var verwijderHtml = isAdmin ?
    '<button onclick="verwijderMelding(\''+docId+'\')" title="Verwijder" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;padding:3px 7px;border-radius:6px;" onmouseover="this.style.color=\'var(--error)\'" onmouseout="this.style.color=\'var(--muted)\'">&#10005;</button>' : '';
  return '<div class="form-card" style="margin-bottom:12px;" id="melding-kaart-'+docId+'">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">' +
    '<div class="form-title" style="margin-bottom:0;">' + escHtml(m.titel || '') + '</div>' +
    verwijderHtml +
    '</div>' +
    '<div style="font-size:0.82rem;color:var(--text);line-height:1.7;margin-bottom:10px;white-space:pre-wrap;">' + escHtml(m.inhoud || '') + '</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
    '<div style="font-size:0.65rem;color:var(--muted);">@' + escHtml(m.gebruiker || '') + ' &middot; ' + formaatDatum(m.datum) + '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<button onclick="stemOpMelding(\''+docId+'\',\'voor\')" style="background:'+(eigenStem==='voor'?'rgba(126,200,150,0.18)':'none')+';border:1px solid '+(eigenStem==='voor'?'var(--success)':'var(--border)')+';border-radius:6px;color:'+(eigenStem==='voor'?'var(--success)':'var(--muted)')+';cursor:pointer;font-size:0.78rem;padding:4px 10px;'+stemDisabled+'" '+(isEigen?'disabled':'')+'>&#10003; '+voorCount+'</button>' +
    '<button onclick="stemOpMelding(\''+docId+'\',\'tegen\')" style="background:'+(eigenStem==='tegen'?'rgba(224,112,112,0.18)':'none')+';border:1px solid '+(eigenStem==='tegen'?'var(--error)':'var(--border)')+';border-radius:6px;color:'+(eigenStem==='tegen'?'var(--error)':'var(--muted)')+';cursor:pointer;font-size:0.78rem;padding:4px 10px;'+stemDisabled+'" '+(isEigen?'disabled':'')+'>&#10005; '+tegenCount+'</button>' +
    '</div></div></div>';
}

function stemOpMelding(docId, stem) {
  db.collection('meldingen').doc(docId).get().then(function(doc) {
    if (!doc.exists) return;
    var stemmen = doc.data().stemmen || {};
    if (doc.data().gebruiker === huidigeGebruiker) return; // eigen melding
    if (stemmen[huidigeGebruiker] === stem) {
      // Zelfde stem: verwijder stem
      delete stemmen[huidigeGebruiker];
    } else {
      stemmen[huidigeGebruiker] = stem;
    }
    db.collection('meldingen').doc(docId).update({stemmen: stemmen}).then(function() {
      // Herlaad de meldingenlijst afhankelijk van welke pagina actief is
      var isNieuws = document.getElementById('pagina-nieuws').style.display !== 'none';
      if (isNieuws) laadEnToonMeldingen();
      var isAdminActief = document.getElementById('admin-sectie-meldingen') && document.getElementById('admin-sectie-meldingen').style.display !== 'none';
      if (isAdminActief) renderAdminMeldingen();
      var isBeheerActief = document.getElementById('beheer-sectie-meldingen') && document.getElementById('beheer-sectie-meldingen').style.display !== 'none';
      if (isBeheerActief) renderBeheerMeldingen();
    });
  });
}

function verstuurNieuwsMelding() {
  var titel = document.getElementById('nieuws-melding-titel').value.trim();
  var inhoud = document.getElementById('nieuws-melding-inhoud').value.trim();
  if (!titel) { alert('Vul een titel in.'); return; }
  if (!inhoud) { alert('Vul een omschrijving in.'); return; }
  var btn = document.getElementById('nieuws-melding-verstuur-btn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>Versturen...';
  db.collection('meldingen').add({
    titel: titel,
    inhoud: inhoud,
    gebruiker: huidigeGebruiker,
    datum: firebase.firestore.Timestamp.now(),
    stemmen: {}
  }).then(function() {
    document.getElementById('nieuws-melding-titel').value = '';
    document.getElementById('nieuws-melding-inhoud').value = '';
    btn.disabled = false; btn.textContent = '+ Versturen';
    laadEnToonMeldingen();
    // Stuur push naar beheerders (via alle abonnees — beheerders zien meldingen in het overzicht)
    verstuurPushNaarAllen(
      '💬 Nieuwe melding van ' + huidigeGebruiker,
      titel,
      'https://boekingschema.netlify.app/?goto=meldingen',
      'nieuws'
    );
  }).catch(function(e) {
    alert('Fout bij versturen: ' + e.message);
    btn.disabled = false; btn.textContent = '+ Versturen';
  });
}

/* ===== ADMIN: UPDATES ===== */
function renderAdminUpdates() {
  var lijst = document.getElementById('admin-updates-lijst');
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('updates').orderBy('aangemaakt', 'desc').get().then(function(snap) {
    if (snap.empty) { lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen updates.</p>'; return; }
    lijst.innerHTML = snap.docs.map(function(d) {
      var u = d.data();
      return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<div style="font-size:0.85rem;font-weight:600;color:var(--accent);">' + escHtml(u.titel||'') + '</div>' +
        '<button onclick="verwijderUpdate(\''+d.id+'\')" title="Verwijder" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;padding:3px 7px;border-radius:6px;" onmouseover="this.style.color=\'var(--error)\'" onmouseout="this.style.color=\'var(--muted)\'">&#10005;</button>' +
        '</div>' +
        '<div style="font-size:0.75rem;color:var(--text);line-height:1.6;margin-bottom:6px;white-space:pre-wrap;">' + escHtml(u.inhoud||'') + '</div>' +
        '<div style="font-size:0.62rem;color:var(--muted);">' + formaatDatum(u.aangemaakt) + '</div>' +
        '</div>';
    }).join('');
  });
}

function publiceerAdminUpdate() {
  var titel = document.getElementById('admin-update-titel').value.trim();
  var inhoud = document.getElementById('admin-update-inhoud').value.trim();
  if (!titel || !inhoud) { alert('Vul titel en inhoud in.'); return; }
  var btn = document.getElementById('admin-update-publiceer-btn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>Publiceren...';
  db.collection('updates').add({
    titel: titel,
    inhoud: inhoud,
    aangemaakt: firebase.firestore.Timestamp.now()
  }).then(function() {
    document.getElementById('admin-update-titel').value = '';
    document.getElementById('admin-update-inhoud').value = '';
    btn.disabled = false; btn.textContent = '📰 Publiceren';
    renderAdminUpdates();
    // Stuur push notificatie naar alle gebruikers
    verstuurPushNaarAllen(
      '📰 ' + titel,
      inhoud.length > 100 ? inhoud.slice(0, 97) + '…' : inhoud,
      'https://boekingschema.netlify.app/?goto=nieuws',
      'nieuws'
    );
  }).catch(function(e) {
    alert('Fout: ' + e.message);
    btn.disabled = false; btn.textContent = '📰 Publiceren';
  });
}

function verwijderUpdate(id) {
  if (!confirm('Update verwijderen?')) return;
  db.collection('updates').doc(id).delete().then(function() {
    renderAdminUpdates();
    renderBeheerUpdates();
  });
}

function renderAdminMeldingen() {
  var lijst = document.getElementById('admin-meldingen-lijst');
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('meldingen').orderBy('datum', 'desc').get().then(function(snap) {
    if (snap.empty) { lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen meldingen ingediend.</p>'; return; }
    lijst.innerHTML = snap.docs.map(function(d) {
      return renderMeldingKaart(d.id, d.data(), true);
    }).join('');
  });
}

function verwijderMelding(id) {
  if (!confirm('Melding verwijderen?')) return;
  db.collection('meldingen').doc(id).delete().then(function() {
    renderAdminMeldingen();
    renderBeheerMeldingen();
    laadEnToonMeldingen();
  });
}

/* ===== BEHEER: UPDATES & MELDINGEN ===== */
function renderBeheerUpdates() {
  var lijst = document.getElementById('beheer-updates-lijst');
  if (!lijst) return;
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('updates').orderBy('aangemaakt', 'desc').get().then(function(snap) {
    if (snap.empty) { lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen updates.</p>'; return; }
    lijst.innerHTML = snap.docs.map(function(d) {
      var u = d.data();
      return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<div style="font-size:0.85rem;font-weight:600;color:var(--accent);">' + escHtml(u.titel||'') + '</div>' +
        '<button onclick="verwijderUpdate(\''+d.id+'\')" title="Verwijder" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;padding:3px 7px;border-radius:6px;" onmouseover="this.style.color=\'var(--error)\'" onmouseout="this.style.color=\'var(--muted)\'">&#10005;</button>' +
        '</div>' +
        '<div style="font-size:0.75rem;color:var(--text);line-height:1.6;margin-bottom:6px;white-space:pre-wrap;">' + escHtml(u.inhoud||'') + '</div>' +
        '<div style="font-size:0.62rem;color:var(--muted);">' + formaatDatum(u.aangemaakt) + '</div>' +
        '</div>';
    }).join('');
  });
}

function publiceerBeheerUpdate() {
  var titel = document.getElementById('beheer-update-titel').value.trim();
  var inhoud = document.getElementById('beheer-update-inhoud').value.trim();
  if (!titel || !inhoud) { alert('Vul titel en inhoud in.'); return; }
  var btn = document.getElementById('beheer-update-publiceer-btn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>Publiceren...';
  db.collection('updates').add({
    titel: titel,
    inhoud: inhoud,
    aangemaakt: firebase.firestore.Timestamp.now()
  }).then(function() {
    document.getElementById('beheer-update-titel').value = '';
    document.getElementById('beheer-update-inhoud').value = '';
    btn.disabled = false; btn.textContent = '📰 Publiceren';
    renderBeheerUpdates();
    // Stuur push notificatie naar alle gebruikers
    verstuurPushNaarAllen(
      '📰 ' + titel,
      inhoud.length > 100 ? inhoud.slice(0, 97) + '…' : inhoud,
      'https://boekingschema.netlify.app/?goto=nieuws',
      'nieuws'
    );
  }).catch(function(e) {
    alert('Fout: ' + e.message);
    btn.disabled = false; btn.textContent = '📰 Publiceren';
  });
}

function renderBeheerMeldingen() {
  var lijst = document.getElementById('beheer-meldingen-lijst');
  if (!lijst) return;
  lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Laden...</p>';
  db.collection('meldingen').orderBy('datum', 'desc').get().then(function(snap) {
    if (snap.empty) { lijst.innerHTML = '<p style="font-size:0.75rem;color:var(--muted);text-align:center;padding:16px 0;">Nog geen meldingen ingediend.</p>'; return; }
    lijst.innerHTML = snap.docs.map(function(d) {
      return renderMeldingKaart(d.id, d.data(), true);
    }).join('');
  });
}

/* ===== BELL: CHECK NIEUWE UPDATES ===== */
function checkNieuweUpdates() {
  var gebruiker = huidigeGebruiker, generatie = authGeneratie;
  return db.collection('updates').get().then(function(snap) {
    if (snap.empty || generatie !== authGeneratie || gebruiker !== huidigeGebruiker) return;
    return db.collection('accounts').doc(gebruiker).get().then(function(doc) {
      if (generatie !== authGeneratie || gebruiker !== huidigeGebruiker) return;
      var gelezen = doc.exists && doc.data().gelezenUpdates ? doc.data().gelezenUpdates : [];
      var heeftNieuw = snap.docs.some(function(d){ return gelezen.indexOf(d.id) === -1; });
      if (heeftNieuw) {
        // Voeg toe aan meldingen array als die nog niet aanwezig is
        var alInLijst = meldingen.some(function(m){ return m.type === 'update'; });
        if (!alInLijst) {
          meldingen.push({
            type: 'update',
            key: 'nieuws_update',
            tekst: 'Nieuwe update beschikbaar! Tik om te bekijken.',
            actie: function() {
              openNieuwsPagina();
            }
          });
          updateBelIcoon();
        }
      }
    });
  }).catch(function() { /* Updates are optional; signing out can cancel this read. */ });
}

/* ===== PUSH NOTIFICATIES ===== */
var VAPID_PUBLIC_KEY = 'BOEI3XCUvuIo6OFNYlGKNc5eue6nwuwk8bYnbqmpxE8P1H6HZttBdJVOA8lLWHaGWoFyMMlhthPANMRHVtYU7DQ';

function urlBase64NaarUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function registreerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    // Luister naar berichten van de Service Worker (navigatie bij klik op notificatie)
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'NAVIGATE') {
        var url = event.data.url || '';
        if (url.indexOf('goto=nieuws') !== -1) openNieuwsPagina();
        else if (url.indexOf('goto=meldingen') !== -1) { openNieuwsPagina(); }
      }
    });
  }).catch(function(e) { console.warn('Service Worker registratie mislukt:', e); });
}

function abonneerOpPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!huidigeGebruiker) return;
  navigator.serviceWorker.ready.then(function(reg) {
    // Check of er al een abonnement is
    reg.pushManager.getSubscription().then(function(bestaand) {
      if (bestaand) {
        // Sla altijd opnieuw op (om te zorgen dat het up-to-date is)
        slaAbonnementOp(bestaand);
        return;
      }
      // Vraag toestemming en maak abonnement
      Notification.requestPermission().then(function(perm) {
        if (perm !== 'granted') return;
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64NaarUint8Array(VAPID_PUBLIC_KEY)
        }).then(function(sub) {
          slaAbonnementOp(sub);
        }).catch(function(e) { console.warn('Push abonnement mislukt:', e); });
      });
    });
  });
}

function slaAbonnementOp(subscription) {
  if (!huidigeGebruiker || !subscription) return;
  db.collection('pushSubscriptions').doc(huidigeGebruiker).set({
    gebruiker: huidigeGebruiker,
    subscription: JSON.parse(JSON.stringify(subscription)),
    bijgewerkt: firebase.firestore.Timestamp.now()
  }).catch(function(e) { console.warn('Abonnement opslaan mislukt:', e); });
}

function verstuurPushNaarAllen(titel, tekst, url, type) {
  if (!isBeheerder()) return;
  // Lees alle push-abonnementen uit Firestore, filter op type-voorkeur per gebruiker
  db.collection('pushSubscriptions').get().then(function(snap) {
    if (snap.empty) return;
    var subscriptions = snap.docs.filter(function(d) {
      var data = d.data();
      if (type === 'nieuws' && data.pushNieuws === false) return false;
      if (type === 'achteraf' && data.pushAchteraf === false) return false;
      return true;
    }).map(function(d) { return d.data().subscription; }).filter(Boolean);
    if (!subscriptions.length) return;
    beveiligdeFetch('/.netlify/functions/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptions: subscriptions,
        title: titel,
        body: tekst,
        url: url,
        tag: 'boekingschema-update'
      })
    }).catch(function(e) { console.warn('Push versturen mislukt:', e); });
  }).catch(function(e) { console.warn('Abonnementen laden mislukt:', e); });
}

document.addEventListener('DOMContentLoaded', function() {
  // Registreer Service Worker bij opstarten
  registreerServiceWorker();

  // Auth
  document.getElementById('verwijder-gebruiker-btn').addEventListener('click', function() {
    var user = document.getElementById('verwijder-gebruiker-overlay').dataset.user;
    verwijderGebruiker(user);
  });
  document.getElementById('verwijder-gebruiker-annuleer').addEventListener('click', function() {
    document.getElementById('verwijder-gebruiker-overlay').style.display = 'none';
  });
  document.getElementById('bewerk-opslaan-btn').addEventListener('click', slaBewerking);
  document.getElementById('bewerk-annuleer').addEventListener('click', function(){ document.getElementById('bewerk-overlay').style.display='none'; });
  document.querySelectorAll('.toggle-opt[data-groep="bewerk-betaling"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.toggle-opt[data-groep="bewerk-betaling"]').forEach(function(b){ b.classList.remove('active'); });
      this.classList.add('active');
    });
  });
  document.getElementById('auth-wissel').addEventListener('click', toggleAuthModus);
  document.getElementById('auth-btn').addEventListener('click', authActie);
  document.getElementById('auth-pass').addEventListener('keydown', function(e){ if(e.key==='Enter') authActie(); });

  // Wachtwoord vergeten
  document.getElementById('vergeten-link').addEventListener('click', function() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('vergeten-overlay').style.display = 'flex';
    document.getElementById('vergeten-error').style.display = 'none';
    document.getElementById('vergeten-success').style.display = 'none';
    document.getElementById('vergeten-user').value = '';
  });
  document.getElementById('vergeten-terug').addEventListener('click', function() {
    document.getElementById('vergeten-overlay').style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'flex';
  });
  document.getElementById('vergeten-btn').addEventListener('click', verstuurWachtwoordReset);
  document.getElementById('verificatie-opnieuw').addEventListener('click', verstuurVerificatieOpnieuw);
  document.getElementById('admin-link').addEventListener('click', openAdminPaneel);
  document.getElementById('admin-terug-link').addEventListener('click', function() {
    toonPagina('schema'); renderOverzicht();
  });
  document.getElementById('admin-genereer-btn').addEventListener('click', function() {
    voegCodeToe(genereerCode()).then(renderAdminCodes);
  });

  // Bel & menu
  function toggleMeldingBar(e) {
    e.stopPropagation();
    zetMenuOpen(false);
    document.getElementById('melding-bar').classList.toggle('open');
  }
  function toggleMenuBar(e) {
    e.stopPropagation();
    document.getElementById('melding-bar').classList.remove('open');
    var open = !document.getElementById('menu-bar').classList.contains('open');
    menuOpener = e.currentTarget;
    zetMenuOpen(open);
    if (open) document.getElementById('menu-schema').focus();
  }
  ['bel-btn','bel-btn-profiel','bel-btn-inst','bel-btn-stat','bel-btn-pathe','bel-btn-nieuws'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('click', toggleMeldingBar); });
  document.querySelectorAll('.hamburger-btn').forEach(function(el) {
    el.setAttribute('aria-label', 'Menu'); el.setAttribute('aria-controls', 'menu-bar'); el.setAttribute('aria-expanded', 'false');
    el.addEventListener('click', toggleMenuBar);
  });
  document.getElementById('melding-sluit').addEventListener('click', function(){ document.getElementById('melding-bar').classList.remove('open'); });
  document.getElementById('melding-bar').addEventListener('click', function(e){ e.stopPropagation(); });
  document.getElementById('menu-bar').addEventListener('click', function(e){ e.stopPropagation(); });
  document.getElementById('menu-sluit').addEventListener('click', function(){
    zetMenuOpen(false, true);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('menu-bar').classList.contains('open')) {
      zetMenuOpen(false, true);
    }
  });
  document.addEventListener('click', function(){
    zetMenuOpen(false);
    document.getElementById('melding-bar').classList.remove('open');
  });

  // Menu items
  document.getElementById('menu-logout').addEventListener('click', uitloggen);
  document.getElementById('menu-nieuws').addEventListener('click', openNieuwsPagina);
  document.getElementById('nieuws-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('nieuws-melding-verstuur-btn').addEventListener('click', verstuurNieuwsMelding);
  document.getElementById('admin-update-publiceer-btn').addEventListener('click', publiceerAdminUpdate);
  document.getElementById('beheer-update-publiceer-btn').addEventListener('click', publiceerBeheerUpdate);
  document.getElementById('menu-statistieken').addEventListener('click', openStatistieken);
  document.getElementById('menu-pathe').addEventListener('click', openPathe);
  document.getElementById('pathe-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('pathe-zoek-btn').addEventListener('click', zoekPatheFilms);
  document.getElementById('pathe-datum').addEventListener('change', function(){ toonTijdsloten(this.value); });
  document.getElementById('statistieken-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('stat-prev').addEventListener('click', function(){ statNavigeer(-1); });
  document.getElementById('stat-next').addEventListener('click', function(){ statNavigeer(1); });
  document.getElementById('stat-today').addEventListener('click', function(){ statAnker=new Date(); statGeselecteerdeDag=null; renderStatistieken(); });
  ['dag','week','maand','jaar'].forEach(function(p) {
    document.getElementById('stat-tab-'+p).addEventListener('click', function() {
      statPeriode=p; statGeselecteerdeDag=null;
      ['dag','week','maand','jaar'].forEach(function(t){ document.getElementById('stat-tab-'+t).classList.toggle('active',t===p); });
      renderStatistieken();
    });
  });
  document.getElementById('menu-schema').addEventListener('click', function(){ toonPagina('schema'); renderOverzicht(); });
  document.getElementById('menu-profiel').addEventListener('click', openProfiel);
  document.getElementById('menu-instellingen').addEventListener('click', openInstellingen);
  document.getElementById('menu-beheer').addEventListener('click', openBeheerPagina);
  document.getElementById('beheer-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('menu-ranglijst').addEventListener('click', openRanglijst);
  document.getElementById('ranglijst-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('beheer-genereer-btn').addEventListener('click', function() {
    voegCodeToe(genereerCode()).then(renderBeheerCodes);
  });
  document.getElementById('profiel-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('instellingen-terug').addEventListener('click', function(){ toonPagina('schema'); });
  document.getElementById('inst-opslaan').addEventListener('click', function() {
    var gapUur=parseInt(document.getElementById('inst-gap-uur').value)||0;
    var gapMin=parseInt(document.getElementById('inst-gap-min').value)||0;
    var minGap=gapUur*60+gapMin;
    var openStr=document.getElementById('inst-open').value;
    var sluitStr=document.getElementById('inst-sluit').value;
    var standaardPrijs = leesPrijs(document.getElementById('inst-prijs').value, 10);
    var maxTijdvakken = parseInt(document.getElementById('inst-max-tijdvakken').value) || 1;
    if (maxTijdvakken < 1) maxTijdvakken = 1;
    if (maxTijdvakken > 4) maxTijdvakken = 4;
    if (!controleerTijdvakAantal(maxTijdvakken)) return;
    var tijdvakNamen = [];
    for (var ti = 0; ti < maxTijdvakken; ti++) {
      var naamEl = document.getElementById('inst-tijdvak-naam-' + ti);
      tijdvakNamen.push(naamEl ? (naamEl.value.trim() || ('Tijdvak ' + (ti+1))) : ('Tijdvak ' + (ti+1)));
    }
    if (!Number.isFinite(standaardPrijs)) { alert('Vul een geldige prijs in (minimaal 0).'); return; }
    if (minGap<1){ alert('Minimale tussentijd moet minimaal 1 minuut zijn.'); return; }
    if (!openStr||!sluitStr){ alert('Vul alle tijden in.'); return; }
    var sluitMin = tijdNaarMin(sluitStr);
    if (sluitMin === 0) sluitMin = 1440; // 00:00 = middernacht
    if (tijdNaarMin(openStr) >= sluitMin) { alert('De sluitingstijd moet na de openingstijd liggen.'); return; }
    slaInstellingenOp(minGap, tijdNaarMin(openStr), sluitMin, standaardPrijs, maxTijdvakken, tijdvakNamen).then(function(){
      document.getElementById('prijs-input').value = standaardPrijs;
      toonPagina('schema'); renderOverzicht();
    }).catch(function() { alert('Instellingen niet opgeslagen. Controleer je verbinding en probeer opnieuw.'); });
  });

  // Schema knoppen
  document.getElementById('add-btn').addEventListener('click', voegBoekingToe);
  document.getElementById('tab-dag').addEventListener('click', function(){ setView('dag'); });
  document.getElementById('tab-week').addEventListener('click', function(){ setView('week'); });
  document.getElementById('tab-maand').addEventListener('click', function(){ setView('maand'); });
  document.getElementById('today-btn').addEventListener('click', naarVandaag);
  document.getElementById('nav-prev').addEventListener('click', function(){ navigeer(-1); });
  document.getElementById('nav-next').addEventListener('click', function(){ navigeer(1); });
  document.getElementById('clear-btn').addEventListener('click', allesLeegmaken);
  document.getElementById('undo-btn').addEventListener('click', ongedaanMaken);
  document.getElementById('log-clear-btn').addEventListener('click', function(){ logItems=[]; renderLog(); });

  // Meer informatie
  document.getElementById('meer-info-toggle').addEventListener('click', function() {
    var sectie=document.getElementById('meer-info-sectie');
    var label=document.getElementById('meer-info-label');
    var open=sectie.classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
    label.textContent=open?'- Minder informatie':'+ Meer informatie';
  });

  // Toggle opties betaling/platform
  document.querySelectorAll('.toggle-opt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var groep=this.getAttribute('data-groep');
      document.querySelectorAll('.toggle-opt[data-groep="'+groep+'"]').forEach(function(b){ b.classList.remove('active'); });
      this.classList.add('active');
    });
  });

  laadThema();
  initScan();
  if (window.ResizeObserver) {
    document.querySelectorAll('#admin-overlay .pagina-header,#pagina-beheer .pagina-header').forEach(function(kop) {
      new ResizeObserver(function() {
        if (kop.offsetHeight > 0) kop.closest('.container').style.setProperty('--beheer-kop-hoogte', kop.offsetHeight + 'px');
      }).observe(kop);
    });
  }

  // Pull-to-refresh
  var ptr_startY = 0, ptr_trekken = false, ptr_drempel = 80;
  var ptr_indicator = document.createElement('div');
  ptr_indicator.id = 'ptr-indicator';
  ptr_indicator.innerHTML = '&#8635; Loslaten om te vernieuwen';
  ptr_indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;text-align:center;padding:12px;font-size:0.72rem;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border);transform:translateY(-100%);transition:transform 0.2s;z-index:300;letter-spacing:0.06em;display:none;';
  document.body.appendChild(ptr_indicator);

  document.addEventListener('touchstart', function(e) {
    ptr_trekken = window.scrollY === 0 && document.getElementById('app').style.display !== 'none' &&
      !e.target.closest('input,select,textarea,button,a,summary,.menu-bar,.melding-bar,.auth-overlay,.week-grid-wrapper') && e.touches.length === 1;
    if (ptr_trekken) ptr_startY = e.touches[0].clientY;
  }, {passive: true});

  document.addEventListener('touchmove', function(e) {
    if (!ptr_trekken) return;
    var delta = e.touches[0].clientY - ptr_startY;
    if (delta > 20) {
      ptr_indicator.style.display = 'block';
      var progress = Math.min(delta / ptr_drempel, 1);
      ptr_indicator.style.transform = 'translateY(' + (progress * 100 - 100) + '%)';
      ptr_indicator.style.color = delta >= ptr_drempel ? 'var(--accent)' : 'var(--muted)';
      ptr_indicator.innerHTML = delta >= ptr_drempel ? '&#8635; Loslaten om te vernieuwen' : '&#8595; Trek naar beneden om te vernieuwen';
    }
  }, {passive: true});

  document.addEventListener('touchend', function(e) {
    if (!ptr_trekken) return;
    ptr_trekken = false;
    var delta = e.changedTouches[0].clientY - ptr_startY;
    ptr_indicator.style.transform = 'translateY(-100%)';
    setTimeout(function(){ ptr_indicator.style.display = 'none'; }, 300);
    if (delta >= ptr_drempel) {
      ptr_indicator.innerHTML = '&#8635; Vernieuwen...';
      ptr_indicator.style.transform = 'translateY(0)';
      ptr_indicator.style.color = 'var(--accent)';
      setTimeout(function(){ window.location.reload(); }, 500);
    }
  }, {passive: true});

  checkSessie();
});
