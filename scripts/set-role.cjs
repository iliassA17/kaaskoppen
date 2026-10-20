const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

async function main() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Certificaatcontrole is uitgeschakeld (NODE_TLS_REJECT_UNAUTHORIZED=0). Verwijder deze instelling voordat je verdergaat. Er is niets gewijzigd.');
  }
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  const projectId = args.includes('--project') && value('--project');
  const username = args.includes('--user') && value('--user');
  const role = args.includes('--role') && value('--role');
  if (!projectId || !username || !['admin', 'beheerder', 'user'].includes(role)) {
    throw new Error('Gebruik --project PROJECT_ID --user GEBRUIKERSNAAM --role admin|beheerder|user [--apply]');
  }
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  const account = await db.collection('accounts').doc(username).get();
  if (!account.exists || !account.data().uid) throw new Error('Het account is nog niet gemigreerd.');
  const authentication = getAuth(app);
  const user = await authentication.getUser(account.data().uid);
  if (!args.includes('--apply')) { console.log('Controle geslaagd. Geen rechten gewijzigd.'); return; }
  await authentication.setCustomUserClaims(user.uid, { ...user.customClaims, admin: role === 'admin', beheerder: role === 'beheerder' });
  await authentication.revokeRefreshTokens(user.uid);
  await db.collection('accounts').doc(username).update({ isBeheerder: role !== 'user' });
  console.log('Rechten gewijzigd. Laat de gebruiker opnieuw inloggen; eerder afgegeven ID-tokens kunnen nog maximaal ongeveer een uur geldig zijn.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
