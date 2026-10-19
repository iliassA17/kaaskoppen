const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.resolve(root, '../.cache/kaaskoppen/config'),
  FIREBASE_EMULATORS_PATH: process.env.FIREBASE_EMULATORS_PATH || path.resolve(root, '../.cache/kaaskoppen/firebase'),
  FIREBASE_PROJECT_ID: 'demo-kaaskoppen',
};
const command = process.argv.includes('--start') ? ['emulators:start'] : [
  'emulators:exec', 'node --test --test-concurrency=1 security/*.test.cjs && npx playwright test --config=playwright.auth.config.cjs',
];
const result = spawnSync(process.execPath, [require.resolve('firebase-tools/lib/bin/firebase.js'),
  ...command, '--project', 'demo-kaaskoppen', '--only', 'auth,firestore'], { cwd: root, env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
