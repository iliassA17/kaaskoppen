const {ViewError, privateDatabase, ownAccount, dayString, shiftDay} = require('./private-view.cjs');

async function ranking(identity, input = {}, database = privateDatabase(), now = Date.now()) {
  if (Object.keys(input).some(key => key !== 'period') || !['dag', 'week', 'maand'].includes(input.period || 'week')) {
    throw new ViewError('Kies dag, week of maand.', 400);
  }
  const {username} = await ownAccount(identity, database);
  const period = input.period || 'week', today = dayString(now), since = shiftDay(today, -6);
  const date = new Date(today + 'T12:00:00Z');
  let start = today, end = today;
  if (period === 'week') {
    start = shiftDay(today, -((date.getUTCDay() + 6) % 7)); end = shiftDay(start, 6);
  } else if (period === 'maand') {
    start = today.slice(0, 8) + '01';
    end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  const [accounts, bookings] = await Promise.all([
    database.collection('accounts').select('ranglijstPrive', 'foto').get(),
    database.collection('boekingen').where('datumStr', '>=', start < since ? start : since)
      .where('datumStr', '<=', end).select('gebruiker', 'datumStr', 'prijs').get()
  ]);
  const scores = new Map(accounts.docs.map(doc => [doc.id, {username: doc.id, active: false,
    private: !!doc.data().ranglijstPrive, bookings: 0, revenueCents: 0, photo: doc.data().foto}]));
  for (const document of bookings.docs) {
    const booking = document.data(), score = scores.get(booking.gebruiker);
    if (!score) continue;
    if (booking.datumStr >= since && booking.datumStr <= today) score.active = true;
    if (booking.datumStr >= start && booking.datumStr <= end) {
      score.bookings++;
      const amount = Number(booking.prijs);
      if (Number.isFinite(amount) && amount >= 0 && amount < 1000000) score.revenueCents += Math.round(amount * 100);
    }
  }
  const eligible = [...scores.values()].filter(score => score.active && !score.private);
  const bookingOrder = [...eligible].sort((a, b) => b.bookings - a.bookings || a.username.localeCompare(b.username));
  const revenueOrder = [...eligible].sort((a, b) => b.revenueCents - a.revenueCents || a.username.localeCompare(b.username));
  eligible.sort((a, b) => (bookingOrder.indexOf(a) + revenueOrder.indexOf(a)) -
    (bookingOrder.indexOf(b) + revenueOrder.indexOf(b)) || a.username.localeCompare(b.username));
  const own = scores.get(username);
  if (own && !eligible.includes(own)) eligible.push(own);
  return {period, start, end, entries: eligible.map((score, index) => ({
    username: score.username, self: score.username === username, qualified: score.active && !score.private,
    rank: score.active && !score.private ? index + 1 : null,
    hiddenReason: score.private ? 'private' : score.active ? null : 'inactive',
    bookings: score.bookings, revenueCents: score.revenueCents,
    ...(typeof score.photo === 'string' && score.photo.length < 200000 &&
      /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(score.photo) ? {photo: score.photo} : {})
  }))};
}
module.exports = {ranking};
