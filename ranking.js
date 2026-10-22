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
  var label = document.createElement('div'); label.className = 'ranglijst-periode';
  label.textContent = '🏆 Ranglijst · ' + ({dag: 'Vandaag', week: 'Deze week', maand: 'Deze maand'}[period]);
  var tabs = document.createElement('div'); tabs.className = 'view-tabs';
  ['dag', 'week', 'maand'].forEach(function(option) {
    var button = document.createElement('button'); button.className = 'view-tab' + (period === option ? ' active' : '');
    button.type = 'button'; button.textContent = option; button.addEventListener('click', function() { tsSetPeriode(option); });
    tabs.appendChild(button);
  });
  bar.append(label, tabs); container.appendChild(bar);
  var list = document.createElement('div'); list.className = 'ranglijst-lijst'; list.setAttribute('aria-live', 'polite');
  list.textContent = 'Ranglijst ophalen…'; container.append(list, explanation);
  try {
    var response = await beveiligdeFetch('/api/ranking', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({period: period})});
    var data = await response.json();
    if (!current()) return;
    if (!response.ok || !Array.isArray(data.entries)) throw new Error(data.error || 'De ranglijst kon niet worden opgehaald.');
    list.replaceChildren();
    if (!data.entries.some(function(entry) { return entry.qualified; })) {
      var empty = document.createElement('p'); empty.className = 'ranglijst-leeg';
      empty.textContent = 'Er staan nog geen openbare actieve gebruikers in de ranglijst.'; list.appendChild(empty);
    }
    var publicEntries = data.entries.filter(function(entry) { return entry.qualified; });
    var mostBookings = publicEntries.slice().sort(function(a, b) { return b.bookings - a.bookings; })[0];
    var mostRevenue = publicEntries.slice().sort(function(a, b) { return b.revenueCents - a.revenueCents; })[0];
    data.entries.forEach(function(entry) {
      var card = document.createElement('article'); card.className = 'ranglijst-kaart' + (!entry.qualified ? ' ranglijst-eigen-inactief' : '');
      card.dataset.username = entry.username;
      card.classList.toggle('ranglijst-eerste', entry.rank === 1);
      card.classList.toggle('ranglijst-zelf', entry.self && entry.qualified);
      var group = list;
      if (!entry.qualified) {
        group = document.createElement('section'); group.className = 'ranglijst-grijs';
        var heading = document.createElement('div'); heading.className = 'ranglijst-groepskop';
        heading.textContent = entry.hiddenReason === 'private' ? '🔒 Niet zichtbaar voor anderen' : 'Nog niet actief genoeg';
        group.appendChild(heading); list.appendChild(group);
      }
      var rank = document.createElement('span'); rank.className = 'ranglijst-positie';
      rank.classList.toggle('ranglijst-podium', entry.rank >= 1 && entry.rank <= 3);
      rank.textContent = entry.rank ? ['🥇', '🥈', '🥉'][entry.rank - 1] || '#' + entry.rank : '—';
      var avatar = document.createElement('span'); avatar.className = 'ranglijst-avatar';
      var photo = veiligeFoto(entry.photo);
      if (photo) { var image = document.createElement('img'); image.src = photo; image.alt = ''; avatar.appendChild(image); }
      else avatar.textContent = entry.username.charAt(0).toUpperCase();
      var details = document.createElement('div'); details.className = 'ranglijst-profiel';
      var name = document.createElement('strong'); name.textContent = '@' + entry.username;
      if (entry.self) {
        var badge = document.createElement('span'); badge.className = 'ranglijst-jij'; badge.textContent = 'Jij';
        if (entry.qualified) card.appendChild(badge);
        else { name.appendChild(document.createTextNode(' · ')); name.appendChild(badge); }
      }
      details.appendChild(name);
      if (!entry.qualified) {
        var note = document.createElement('p');
        note.textContent = entry.hiddenReason === 'private' ? 'Privéprofiel · alleen jij ziet deze rij' : 'Nog niet actief genoeg · alleen jij ziet deze rij';
        details.appendChild(note);
      }
      var stats = document.createElement('div'); stats.className = 'ranglijst-cijfers';
      var topBookings = entry === mostBookings, topRevenue = entry === mostRevenue;
      var count = document.createElement('span'); count.textContent = '📅 ' + entry.bookings + (topBookings ? ' 🏆' : '');
      var revenue = document.createElement('span'); revenue.textContent = '💶 ' + factuurBedrag(entry.revenueCents, 'EUR') + (topRevenue ? ' 🏆' : '');
      count.classList.toggle('ranglijst-score-leider', topBookings);
      revenue.classList.toggle('ranglijst-score-leider', topRevenue);
      stats.append(count, revenue); card.append(rank, avatar, details, stats); group.appendChild(card);
    });
  } catch (failure) {
    if (current()) { list.textContent = failure.message || 'De ranglijst is tijdelijk niet beschikbaar.'; list.setAttribute('role', 'alert'); }
  }
}
