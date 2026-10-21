const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const toml = require('toml');

test('gebundelde Netlify Functions starten zonder experimenteel require van ES-modules', {timeout: 120000}, async () => {
  // AWS Lambda disables this Node feature. The normal development runtime can
  // otherwise hide a CommonJS/ESM dependency incompatibility until deployment.
  const root = path.resolve(__dirname, '..');
  const config = toml.parse(await fs.readFile(path.join(root, 'netlify.toml'), 'utf8'));
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'kaaskoppen-netlify-runtime-'));
  try {
    const {zipFunctions} = await import('@netlify/zip-it-and-ship-it');
    const functions = await zipFunctions(path.join(root, config.build.functions), destination, {
      archiveFormat: 'none', basePath: root,
      config: {'*': {nodeBundler: config.functions?.node_bundler, nodeVersion: config.build.environment.NODE_VERSION}},
    });
    const expectedNames = (await fs.readdir(path.join(root, config.build.functions)))
      .filter(name => name.endsWith('.js')).map(name => path.basename(name, '.js')).sort();
    assert.deepEqual(functions.map(entry => entry.name).sort(), expectedNames);
    const entries = functions.map(entry => ({name: entry.name, path: path.join(entry.path, entry.name + '.js')}));
    const source = `
    const assert = require('node:assert/strict');
    (async () => {
      const functions = ${JSON.stringify(entries)};
      for (const entry of functions) {
        const {handler} = require(entry.path);
        assert.equal(typeof handler, 'function');
        if (entry.name !== 'stripe-webhook') {
          const response = await handler({httpMethod: 'POST', headers: {}, body: '{}'});
          assert.equal(response.statusCode, 401, entry.name);
        }
      }
      const {handler} = require(functions.find(entry => entry.name === 'subscription-status').path);
      const response = await handler({httpMethod: 'POST', headers: {}});
      assert.deepEqual(JSON.parse(response.body), {error: 'Log eerst in.'});
      assert.equal((await handler({httpMethod: 'GET', headers: {}})).statusCode, 405);
    })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', source], {
      cwd: root, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally {
    await fs.rm(destination, {recursive: true, force: true});
  }
});
