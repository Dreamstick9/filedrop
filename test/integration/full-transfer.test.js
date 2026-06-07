/**
 * Integration test: Full transfer success
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createTempFile, cleanupTempFiles } = require('../helpers/create-temp-file.js');
const { httpClient } = require('../helpers/http-client.js');

test('Full transfer integration', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('Spawns filedrop, downloads file, exits cleanly', async () => {
    // Skipping if CLI is not implemented
    try {
      require.resolve('../../src/cli.js');
    } catch {
      t.skip('cli.js not implemented yet');
      return;
    }

    const filePath = createTempFile(1024);
    const cliPath = path.join(__dirname, '../../src/cli.js');

    const filedropProcess = spawn(process.execPath, [cliPath, filePath, '--port', '8123', '--no-mdns']);
    
    let output = '';
    filedropProcess.stdout.on('data', data => output += data.toString());
    filedropProcess.stderr.on('data', data => output += data.toString());

    // wait for server to start
    await new Promise(r => setTimeout(r, 1000));

    const res = await httpClient('http://127.0.0.1:8123/');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.length, 1024);

    // wait for process to exit
    const code = await new Promise(resolve => filedropProcess.on('exit', resolve));
    assert.strictEqual(code, 0, 'Process should exit with code 0 after successful transfer');
    assert.ok(output.includes('http://127.0.0.1:8123/'), 'QR output or URL should be printed');
  });
});
