var ranglijstVersie = 0;

function resetRanglijst() {
  ranglijstVersie++;
  document.getElementById('ranglijst-inhoud').replaceChildren();
}

async function laadPubliekeRanglijst() {
  var version = ++ranglijstVersie, generation = authGeneratie;
  var uid = auth.currentUser && auth.currentUser.uid, period = tsPeriode;
  var container = document.getElementById('ranglijst-inhoud');
  function current() {
    return version === ranglijstVersie && generation === authGeneratie && auth.currentUser &&
      uid === auth.currentUser.uid && tsContext === 'gebruiker';
  }
  container.replaceChildren();
  var bar = document.createElement('div'); bar.className = 'ranglijst-balk';
  var explanation = document.createElement('p'); explanation.className = 'ranglijst-uitleg';
  explanation.textContent = 'Zichtbaar voor anderen na minimaal één boeking in de afgelopen zeven dagen. Privéprofielen blijven verborgen.';
  var tabs = document.createElement('div'); tabs.className = 'view-tabs';
  ['dag', 'week', 'maand'].forEach(function(option) {
    var button = document.createElement('button'); button.className = 'view-tab' + (period === option ? ' active' : '');
    button.type = 'button'; button.textContent = option; button.addEventListener('click', function() { tsSetPeriode(option); });
    tabs.appendChild(button);
  });
  bar.append(explanation, tabs); container.appendChild(bar);
  var list = document.createElement('div'); list.className = 'ranglijst-lijst'; list.setAttribute('aria-live', 'polite');
  list.textContent = 'Ranglijst ophalen…'; container.appendChild(list);
  try {
    var response = await beveiligdeFetch('/api/ranking', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({period: period})});
    var data = await response.json();
    if (!current()) return;
    if (!response.ok || !Array.isArray(data.entries)) throw new Error(data.error || 'De ranglijst kon niet worden opgehaald.');
    list.replaceChildren();
    if (!data.entries.some(function(entry) { return entry.qualified; })) {
      var empty = document.createElement('p'); empty.className = 'ranglijst-uitleg';
      empty.textContent = 'Er staan nog geen openbare actieve gebruikers in de ranglijst.'; list.appendChild(empty);
    }
    data.entries.forEach(function(entry) {
      var card = document.createElement('article'); card.className = 'ranglijst-kaart' + (!entry.qualified ? ' ranglijst-eigen-inactief' : '');
      card.dataset.username = entry.username;
      var rank = document.createElement('span'); rank.className = 'ranglijst-positie';
      rank.textContent = entry.rank ? ['🥇', '🥈', '🥉'][entry.rank - 1] || '#' + entry.rank : '—';
      var avatar = document.createElement('span'); avatar.className = 'ranglijst-avatar';
      var photo = veiligeFoto(entry.photo);
      if (photo) { var image = document.createElement('img'); image.src = photo; image.alt = ''; avatar.appendChild(image); }
      else avatar.textContent = entry.username.charAt(0).toUpperCase();
      var details = document.createElement('div'); details.className = 'ranglijst-profiel';
      var name = document.createElement('strong'); name.textContent = '@' + entry.username + (entry.self ? ' · Jij' : '');
      details.appendChild(name);
      if (!entry.qualified) {
        var note = document.createElement('p');
        note.textContent = entry.hiddenReason === 'private' ? 'Privéprofiel · alleen jij ziet deze rij' : 'Nog niet actief genoeg · alleen jij ziet deze rij';
        details.appendChild(note);
      }
      var stats = document.createElement('div'); stats.className = 'ranglijst-cijfers';
      var count = document.createElement('span'); count.textContent = entry.bookings + ' boekingen';
      var revenue = document.createElement('span'); revenue.textContent = factuurBedrag(entry.revenueCents, 'EUR');
      stats.append(count, revenue); card.append(rank, avatar, details, stats); list.appendChild(card);
    });
  } catch (failure) {
    if (current()) { list.textContent = failure.message || 'De ranglijst is tijdelijk niet beschikbaar.'; list.setAttribute('role', 'alert'); }
  }
}
