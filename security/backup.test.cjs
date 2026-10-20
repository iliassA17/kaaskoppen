const { before, beforeEach, afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtemp, readFile, writeFile, rm, access } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, GeoPoint } = require('firebase-admin/firestore');
const { backupFirestore, decodeValue, verifyBackup } = require('../scripts/backup-firestore.cjs');

const projectId = 'demo-kaaskoppen';
const clearUrl = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`;
let database, directory;
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  database = getFirestore(initializeApp({ projectId }, 'backup-tests'));
  database.settings({ useBigInt: true });
});
beforeEach(async () => {
  assert.equal((await fetch(clearUrl, { method: 'DELETE' })).ok, true);
  directory = await mkdtemp(path.join(os.tmpdir(), 'kaaskoppen-backup-'));
});
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test('Firestore-back-up bewaart documenten, subcollecties en veldtypen en kan worden hersteld', async () => {
  const original = new Map();
  original.set('accounts/path\u00e9plug', { gebruiker: 'path\u00e9plug', email: 'owner@example.test', hash: 'oude-hash' });
  original.set('boekingen/bestaand', { gebruiker: 'path\u00e9plug', prijs: 0 });
  original.set('instellingen/path\u00e9plug', {
    tijdstip: new Timestamp(1700000000, 123456789), locatie: new GeoPoint(52.1, 4.3),
    eigenaar: database.doc('accounts/path\u00e9plug'), bytes: Buffer.from([0, 127, 255]),
    groot: 9223372036854775807n, klein: -9223372036854775808n,
    velden: [null, 'tekst', false, 1.25, { type: 'timestamp', value: 'gewone velden', speciaal: NaN, oneindig: Infinity }],
  });
  original.set('archief/ontbreekt/items/een', { notitie: 'Subcollectie zonder bestaand bovenliggend document' });
  for (const [documentPath, data] of original) await database.doc(documentPath).set(data);
  // Compare with Firestore's representation (integer values read as BigInt).
  for (const documentPath of original.keys()) original.set(documentPath, (await database.doc(documentPath).get()).data());
  const outputFile = path.join(directory, 'veilig.firestore-backup.json');
  const result = await backupFirestore({ database, projectId, outputFile });
  assert.equal(result.documenten, original.size);
  assert.equal(result.collecties.accounts, 1);
  assert.equal(result.collecties.boekingen, 1);
  const backup = verifyBackup(JSON.parse(await readFile(outputFile, 'utf8')));
  assert.equal(backup.projectId, projectId);
  assert.deepEqual(backup.documents.map(doc => doc.path).sort(), [...original.keys()].sort());
  for (const [documentPath, data] of original) assert.deepEqual((await database.doc(documentPath).get()).data(), data);

  const cli = spawnSync(process.execPath, ['scripts/backup-firestore.cjs', '--project', projectId], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, LOCALAPPDATA: directory },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /BACK-UP GESLAAGD/);
  assert.doesNotMatch(cli.stdout, /owner@example\.test|oude-hash/);
  const summary = JSON.parse(cli.stdout.split('\n').find(line => line.startsWith('{')));
  assert.equal(path.dirname(summary.bestand), path.join(directory, 'KaaskoppenBackups'));
  assert.equal(summary.documenten, original.size);
  verifyBackup(JSON.parse(await readFile(summary.bestand, 'utf8')));

  assert.equal((await fetch(clearUrl, { method: 'DELETE' })).ok, true);
  for (const record of backup.documents) await database.doc(record.path).set(decodeValue(record.data, database));
  for (const [documentPath, data] of original) assert.deepEqual((await database.doc(documentPath).get()).data(), data);
  backup.documents[0].data = ['map', []];
  assert.throws(() => verifyBackup(backup), /onvolledig of beschadigd/);
});

test('back-ups overschrijven geen bestanden en kunnen niet in de publicatiemap worden opgeslagen', async () => {
  const outputFile = path.join(directory, 'bestaand.firestore-backup.json');
  await writeFile(outputFile, 'bestaande privegegevens');
  await assert.rejects(backupFirestore({ database, projectId, outputFile }), { code: 'EEXIST' });
  assert.equal(await readFile(outputFile, 'utf8'), 'bestaande privegegevens');
  const forbidden = path.resolve(__dirname, '../ongewenst.firestore-backup.json');
  await assert.rejects(backupFirestore({ database, projectId, outputFile: forbidden }), /buiten de appmap/);
  await assert.rejects(access(forbidden), { code: 'ENOENT' });
});

test('een afgebroken uitlezing maakt geen onvolledige back-up aan', async () => {
  const outputFile = path.join(directory, 'mislukt.firestore-backup.json');
  const unavailable = { async listCollections() { throw new Error('Geen verbinding'); } };
  await assert.rejects(backupFirestore({ database: unavailable, projectId, outputFile }), /Geen verbinding/);
  await assert.rejects(access(outputFile), { code: 'ENOENT' });
});
