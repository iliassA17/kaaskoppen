const {ViewError, privateDatabase, ownAccount, dayString, shiftDay, validDay} = require('./private-view.cjs');

async function schedulePreview(identity, input = {}, database = privateDatabase(), now = Date.now()) {
  if (Object.keys(input).length) throw new ViewError('Ongeldig verzoek.', 400);
  const {username} = await ownAccount(identity, database);
  // An expired owner may see only this non-interactive illustration. Never
  // return booking IDs, names, notes, prices or another account's records.
  const snapshot = await database.collection('boekingen').where('gebruiker', '==', username)
    .select('datumStr', 'start', 'eind').get();
  const bookings = snapshot.docs.map(doc => doc.data()).filter(booking => validDay(booking.datumStr));
  const today = dayString(now), dates = [...new Set(bookings.map(booking => booking.datumStr))].sort();
  let anchor = today;
  const monday = day => shiftDay(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const currentStart = monday(today);
  if (!dates.some(day => day >= currentStart && day <= shiftDay(currentStart, 6)) && dates.length) {
    anchor = dates.find(day => day >= today) || dates.at(-1);
  }
  const start = monday(anchor), labels = ['MA', 'DI', 'WO', 'DO', 'VR', 'ZA', 'ZO'];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="940" viewBox="0 0 1280 940">' +
    '<rect width="1280" height="940" fill="#0f0e0c"/>' +
    '<g font-family="sans-serif"><text x="65" y="85" fill="#e8c97a" font-size="38">Boekingsschema</text>' +
    '<text x="65" y="118" fill="#aaa59a" font-size="13" letter-spacing="3">RESERVERINGSBEHEER</text>' +
    '<rect x="65" y="162" width="1150" height="170" rx="16" fill="#1a1916" stroke="#38362f"/>' +
    '<text x="92" y="202" fill="#e8c97a" font-size="20">Nieuwe boeking</text>';
  for (const [x, width] of [[92, 330], [442, 280], [742, 280]]) {
    svg += '<rect x="' + x + '" y="236" width="' + width + '" height="48" rx="8" fill="#242320" stroke="#38362f"/>';
  }
  svg += '<rect x="1042" y="236" width="145" height="48" rx="8" fill="#e8c97a"/>' +
    '<text x="1082" y="266" fill="#171511" font-size="14">Toevoegen</text>' +
    '<text x="65" y="394" fill="#e8c97a" font-size="17">Jouw planning</text>' +
    '<text x="960" y="394" fill="#c2bdaf" font-size="15">' + start + ' — ' + shiftDay(start, 6) + '</text>';
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(start, i), x = 65 + i * 166;
    const daily = bookings.filter(booking => booking.datumStr === day);
    svg += '<rect x="' + x + '" y="420" width="154" height="390" rx="12" fill="#1a1916" stroke="#494535"/>' +
      '<text x="' + (x + 14) + '" y="449" fill="#a9a18b" font-size="13">' + labels[i] + '</text>' +
      '<text x="' + (x + 14) + '" y="481" fill="#e8c97a" font-size="26">' + Number(day.slice(8)) + '</text>';
    daily.slice(0, 5).forEach((booking, row) => {
      const y = 506 + row * 53;
      const minute = Number.isInteger(booking.start) && booking.start >= 0 && booking.start < 1440 ? booking.start : null;
      const time = minute === null ? 'Gepland' : String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      svg += '<rect x="' + (x + 9) + '" y="' + y + '" width="136" height="43" rx="6" fill="#2d3a30" stroke="#587660"/>' +
        '<text x="' + (x + 18) + '" y="' + (y + 18) + '" fill="#d7dfd2" font-size="12">' + time + '</text>' +
        '<text x="' + (x + 18) + '" y="' + (y + 33) + '" fill="#a7b59e" font-size="10">Geplande boeking</text>';
    });
    if (!daily.length) svg += '<text x="' + (x + 53) + '" y="550" fill="#68675f" font-size="12">vrij</text>';
    if (daily.length > 5) svg += '<text x="' + (x + 16) + '" y="798" fill="#c2bdaf" font-size="12">+' + (daily.length - 5) + ' boekingen</text>';
  }
  return svg + '<text x="65" y="870" fill="#b8af98" font-size="15">Je boekingen blijven bewaard. Hervat je toegang om verder te plannen.</text></g></svg>';
}
module.exports = {schedulePreview};
