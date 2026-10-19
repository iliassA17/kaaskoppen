const { createHash } = require('node:crypto');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function legacyUid(name) {
  return 'legacy_' + createHash('sha256').update(name).digest('hex').slice(0, 48);
}

async function findUser(authentication, method, value) {
  try { return await authentication[method](value); }
  catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
}

async function migrate({ database, authentication, apply = false, adminUsers = [], staffUsers = [] }) {
  const accounts = await database.collection('accounts').get();
  const codes = await database.collection('codes').get();
  const names = new Set(accounts.docs.map(doc => doc.id));
  for (const name of [...adminUsers, ...staffUsers]) {
    if (!names.has(name)) throw new Error('Een opgegeven beheerder heeft geen bestaand account.');
  }
  const emails = new Set();
  const planned = [];
  for (const doc of accounts.docs) {
    const data = doc.data();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(doc.id) || ['constructor', 'prototype'].includes(doc.id)) {
      throw new Error('Een bestaande gebruikersnaam voldoet niet aan de nieuwe naamregels. Corrigeer die eerst met behoud van de gekoppelde gegevens.');
    }
    if (data.gebruiker !== doc.id || typeof data.email !== 'string' || !data.email.includes('@')) {
      throw new Error('Een account heeft een ontbrekende gebruikersnaam of ongeldig e-mailadres.');
    }
    const email = data.email.trim().toLowerCase();
    if (emails.has(email)) throw new Error('Meerdere accounts gebruiken hetzelfde e-mailadres. Los dit eerst op.');
    emails.add(email);
    const uid = data.uid || legacyUid(doc.id);
    const existing = await findUser(authentication, 'getUser', uid);
    const existingEmail = await findUser(authentication, 'getUserByEmail', email);
    if ((existing && existing.email?.toLowerCase() !== email) || (existingEmail && existingEmail.uid !== uid)) {
      throw new Error('Er bestaat een conflicterende Firebase-identiteit. Koppel deze handmatig na controle van de eigenaar.');
    }
    const mapping = await database.collection('authUsers').doc(uid).get();
    if (mapping.exists && mapping.data().gebruiker !== doc.id) throw new Error('Een UID is al aan een andere gebruiker gekoppeld.');
    planned.push({ doc, data, email, uid, existing });
  }
  const normalizedCodes = new Map();
  for (const doc of codes.docs) {
    const data = doc.data();
    const code = String(data.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{5,64}$/.test(code) || typeof data.gebruikt !== 'boolean') throw new Error('Er is een ongeldige uitnodigingscode.');
    if (normalizedCodes.has(code)) throw new Error('Dubbele uitnodigingscode. Los deze eerst op.');
    normalizedCodes.set(code, { doc, data });
  }
  if (!apply) return { accounts: planned.length, codes: normalizedCodes.size, applied: false };

  for (const { doc, email, uid, existing } of planned) {
    // Never import the insecure legacy password hash or mark an email verified.
    if (!existing) await authentication.createUser({ uid, email, emailVerified: false, displayName: doc.id });
    const claims = { ...(existing?.customClaims || {}) };
    if (adminUsers.includes(doc.id)) claims.admin = true;
    if (staffUsers.includes(doc.id)) claims.beheerder = true;
    if (adminUsers.includes(doc.id) || staffUsers.includes(doc.id)) await authentication.setCustomUserClaims(uid, claims);
    const batch = database.batch();
    batch.update(doc.ref, { uid, email, hash: FieldValue.delete(), isBeheerder: claims.admin === true || claims.beheerder === true });
    batch.set(database.collection('authUsers').doc(uid), { gebruiker: doc.id });
    await batch.commit();
  }
  for (const [code, { doc, data }] of normalizedCodes) {
    if (doc.id === code) continue;
    const batch = database.batch();
    batch.set(database.collection('codes').doc(code), { ...data, code });
    batch.delete(doc.ref);
    await batch.commit();
  }
  const resets = await database.collection('resets').get();
  for (const doc of resets.docs) await doc.ref.delete();
  return { accounts: planned.length, codes: normalizedCodes.size, applied: true };
}

async function main() {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf('--project');
  const projectId = args[projectIndex + 1];
  if (projectIndex < 0 || !projectId || projectId.startsWith('--')) throw new Error('Gebruik --project PROJECT_ID; standaard wordt uitsluitend gecontroleerd. Voeg --apply toe om te migreren.');
  const values = flag => args.flatMap((value, i) => value === flag && args[i + 1] ? [args[i + 1]] : []);
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const result = await migrate({ database: getFirestore(app), authentication: getAuth(app),
    apply: args.includes('--apply'), adminUsers: values('--admin'), staffUsers: values('--staff') });
  console.log(JSON.stringify(result));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate, legacyUid };
