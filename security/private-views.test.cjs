const {before, beforeEach, test} = require('node:test');
const assert = require('node:assert/strict');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {ranking} = require('../netlify/lib/ranking.cjs');
const {schedulePreview} = require('../netlify/lib/schedule-preview.cjs');
const {dayString} = require('../netlify/lib/private-view.cjs');
const fs = require('node:fs');
const path = require('node:path');

const now = Date.UTC(2026, 9, 22, 10), identity = {user: {uid: 'alice-uid'}};
let database;
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  database = getFirestore(initializeApp({projectId: 'demo-kaaskoppen'}, 'private-view-tests'));
});
beforeEach(async () => {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-kaaskoppen/databases/(default)/documents', {method: 'DELETE'});
  for (const name of ['alice', 'bob', 'private-carol', 'inactive-dave', 'future-eve']) {
    await database.doc('accounts/' + name).set({uid: name + '-uid', gebruiker: name,
      email: name + '@private.example.test', uitnodigingscode: 'GEHEIM', ranglijstPrive: name === 'private-carol'});
    await database.doc('authUsers/' + name + '-uid').set({gebruiker: name});
  }
  for (const [id, gebruiker, datumStr, prijs, start] of [
    ['b1', 'bob', '2026-10-21', 7.99, 600], ['b2', 'bob', '2026-10-22', 10, 700],
    ['private', 'private-carol', '2026-10-22', 999, 975],
    ['old', 'inactive-dave', '2026-10-01', 1, 800], ['future', 'future-eve', '2026-10-24', 20, 900],
    ['own', 'alice', '2026-10-01', 30, 540]
  ]) await database.doc('boekingen/' + id).set({gebruiker, datumStr, prijs, start, eind: start + 95,
    naam: 'KLANTNAAM-NIET-TONEN', notitie: 'PRIVE-NOTITIE'});
});

test('ranglijst toont openbare actieve scores plus alleen het eigen grijze inactieve profiel', async () => {
  const result = await ranking(identity, {period: 'week'}, database, now);
  assert.deepEqual(result.entries.map(entry => entry.username), ['bob', 'alice']);
  assert.equal(result.entries[0].bookings, 2);
  assert.equal(result.entries[0].revenueCents, 1799);
  assert.equal(result.entries[0].rank, 1);
  assert.equal(result.entries[1].self, true);
  assert.equal(result.entries[1].qualified, false);
  assert.equal(result.entries[1].rank, null);
  assert.equal(result.entries[1].hiddenReason, 'inactive');
  assert.doesNotMatch(JSON.stringify(result), /private-carol|inactive-dave|future-eve|private\.example|GEHEIM|KLANTNAAM|PRIVE-NOTITIE|alice-uid/);
});

test('eigen privéprofiel blijft alleen voor zichzelf zichtbaar; privé zetten verwijdert een actieve gebruiker uit andere ranglijsten', async () => {
  await database.doc('accounts/alice').update({ranglijstPrive: true});
  assert.equal((await ranking(identity, {}, database, now)).entries.at(-1).hiddenReason, 'private');
  await database.doc('accounts/bob').update({ranglijstPrive: true});
  assert.deepEqual((await ranking(identity, {}, database, now)).entries.map(entry => entry.username), ['alice']);
  await database.doc('accounts/bob').update({ranglijstPrive: 'true'});
  assert.deepEqual((await ranking(identity, {}, database, now)).entries.map(entry => entry.username), ['alice']);
});

test('periodefilters tellen dag, week en maand; Amsterdamse middernacht en toekomstige boekingen kwalificeren correct', async () => {
  assert.equal(dayString(Date.UTC(2026, 9, 21, 23)), '2026-10-22');
  const day = await ranking(identity, {period: 'dag'}, database, now);
  assert.equal(day.entries[0].bookings, 1);
  const month = await ranking(identity, {period: 'maand'}, database, now);
  assert.equal(month.entries.at(-1).revenueCents, 3000);
  assert.ok(!month.entries.some(entry => entry.username === 'future-eve'));
});

test('eigen achtergrond bevat de planning maar geen klantnamen, notities, bedragen, ID’s of andermans planning', async () => {
  const svg = await schedulePreview(identity, {}, database, now);
  assert.match(svg, /^<svg/);
  assert.match(svg, /09:00/);
  assert.match(svg, /2026-09-28/);
  assert.match(svg, /Geplande boeking/);
  assert.doesNotMatch(svg, /16:15|bob|private-carol|KLANTNAAM|PRIVE-NOTITIE|GEHEIM|alice-uid|<script|<foreignObject/);
});

test('weergaven accepteren nooit een vreemde identiteit, datumbereik of onjuiste accountkoppeling', async () => {
  await assert.rejects(ranking(identity, {uid: 'bob-uid'}, database, now), error => error.status === 400);
  await assert.rejects(ranking(identity, {period: 'alles'}, database, now), error => error.status === 400);
  await assert.rejects(schedulePreview(identity, {username: 'bob'}, database, now), error => error.status === 400);
  await database.doc('authUsers/alice-uid').set({gebruiker: 'bob'});
  await assert.rejects(ranking(identity, {}, database, now), error => error.status === 403);
  await assert.rejects(schedulePreview(identity, {}, database, now), error => error.status === 403);
});

test('manifest, telefooniconen en favicon bevatten de juiste echte afbeeldingsformaten', () => {
  const root = path.join(__dirname, '..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/app/'); assert.equal(manifest.scope, '/app/'); assert.equal(manifest.id, '/');
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    const data = fs.readFileSync(path.join(root, name));
    assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  }
  assert.equal(fs.readFileSync(path.join(root, 'favicon.ico')).readUInt16LE(2), 1);
});
