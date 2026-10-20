const { createHash, randomUUID } = require('node:crypto');
const { mkdir, open, readFile, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp, GeoPoint, DocumentReference } = require('firebase-admin/firestore');

function requireVerifiedTls() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Certificaatcontrole is uitgeschakeld. Verwijder NODE_TLS_REJECT_UNAUTHORIZED=0 voordat je verdergaat.');
  }
}

// Tag every value, including maps, so user fields cannot collide with type tags.
function encodeValue(value, database) {
  if (value === null) return ['null'];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'bigint') return ['integer', String(value)];
  if (value instanceof Timestamp) return ['timestamp', [value.seconds, value.nanoseconds]];
  if (value instanceof GeoPoint) return ['geopoint', [value.latitude, value.longitude]];
  if (value instanceof DocumentReference) {
    if (value.firestore.projectId !== database.projectId || value.firestore.databaseId !== database.databaseId) {
      throw new Error('Een verwijzing naar een andere database wordt nog niet ondersteund. Er is geen complete back-up gemaakt.');
    }
    return ['reference', value.path];
  }
  if (value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')];
  if (Array.isArray(value)) return ['array', value.map(item => encodeValue(item, database))];
  if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return ['map', Object.entries(value).map(([key, item]) => [key, encodeValue(item, database)])];
  }
  throw new Error('Een veldtype wordt nog niet ondersteund. Er is geen complete back-up gemaakt.');
}

function decodeValue(encoded, database) {
  const [type, value] = encoded;
  switch (type) {
    case 'null': return null;
    case 'string': case 'boolean': return value;
    case 'number': return Number(value);
    case 'integer': return BigInt(value);
    case 'timestamp': return new Timestamp(...value);
    case 'geopoint': return new GeoPoint(...value);
    case 'reference': return database.doc(value);
    case 'bytes': return Buffer.from(value, 'base64');
    case 'array': return value.map(item => decodeValue(item, database));
    case 'map': return Object.fromEntries(value.map(([key, item]) => [key, decodeValue(item, database)]));
    default: throw new Error('Onbekend veldtype in de back-up.');
  }
}

function digest(documents) {
  return createHash('sha256').update(JSON.stringify(documents)).digest('hex');
}

function verifyBackup(backup) {
  if (backup.format !== 'kaaskoppen-firestore-v1' || !Array.isArray(backup.documents) ||
      backup.documentCount !== backup.documents.length || backup.sha256 !== digest(backup.documents)) {
    throw new Error('De back-up is onvolledig of beschadigd.');
  }
  return backup;
}

async function backupFirestore({ database, projectId, outputFile }) {
  requireVerifiedTls();
  const destination = path.resolve(outputFile);
  const relative = path.relative(path.resolve(__dirname, '..'), destination);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Bewaar de back-up buiten de appmap, zodat deze niet op Netlify of GitHub terechtkomt.');
  }
  const startedAt = new Date().toISOString();
  const documents = [];
  const collections = {};
  async function visit(parent) {
    for (const collection of await parent.listCollections()) {
      if (parent === database) collections[collection.id] = 0;
      // listDocuments also finds missing parent documents with live subcollections.
      const references = await collection.listDocuments();
      for (let i = 0; i < references.length; i += 100) {
        const snapshots = await database.getAll(...references.slice(i, i + 100));
        for (const snapshot of snapshots) {
          if (snapshot.exists) {
            documents.push({ path: snapshot.ref.path, data: encodeValue(snapshot.data(), database) });
            if (parent === database) collections[collection.id]++;
          }
          await visit(snapshot.ref);
        }
      }
    }
  }
  await visit(database);
  documents.sort((a, b) => a.path.localeCompare(b.path));
  const backup = { format: 'kaaskoppen-firestore-v1', projectId, startedAt,
    finishedAt: new Date().toISOString(), documentCount: documents.length, documents, sha256: digest(documents) };
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const file = await open(destination, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(backup, null, 2) + '\n', 'utf8');
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(destination);
    throw error;
  }
  await file.close();
  verifyBackup(JSON.parse(await readFile(destination, 'utf8')));
  return { bestand: destination, documenten: documents.length, collecties: collections };
}

async function main() {
  requireVerifiedTls();
  const args = process.argv.slice(2);
  const value = flag => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : null;
  };
  const projectId = value('--project');
  if (!projectId) throw new Error('Gebruik --project PROJECT_ID. Dit script leest alleen Firestore en maakt een lokaal back-upbestand.');
  if (args.includes('--output') && !value('--output')) throw new Error('Vul na --output een bestandsnaam in.');
  const base = process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  const outputFile = value('--output') || path.join(base, 'KaaskoppenBackups',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.firestore-backup.json');
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const database = getFirestore(app);
  database.settings({ useBigInt: true });
  console.log('BACK-UP START. Houd de app even ongebruikt; er wordt alleen gelezen.');
  console.log(JSON.stringify(await backupFirestore({ database, projectId, outputFile })));
  console.log('BACK-UP GESLAAGD. Bewaar het bestand op je computer en deel het niet.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { backupFirestore, decodeValue, verifyBackup };
