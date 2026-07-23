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
    const cliPath = path.join(__dirname, '../../bin/filedrop.js');

    const filedropProcess = spawn(process.execPath, [cliPath, filePath, '--port', '8123', '--no-mdns', '--download-limit', '1']);
    
    let output = '';
    filedropProcess.stdout.on('data', data => output += data.toString());
    filedropProcess.stderr.on('data', data => output += data.toString());

    // wait for server to start
    await new Promise(r => setTimeout(r, 2000));

    const res = await httpClient('http://127.0.0.1:8123/');
    assert.strictEqual(res.statusCode, 200);

    const downloadPathMatch = res.body.toString().match(/fetch\('([^']+)'/);
    assert.ok(downloadPathMatch, 'Should find download path in HTML');
    const downloadPath = downloadPathMatch[1];

    const keyHexMatch = output.match(/#([0-9a-fA-F]+)/);
    assert.ok(keyHexMatch, 'Should find decryption key in output');
    const keyHex = keyHexMatch[1];

    const downloadRes = await httpClient(`http://127.0.0.1:8123${downloadPath}`);
    assert.strictEqual(downloadRes.statusCode, 200);

    // Decrypt the response body to verify correctness
    const crypto = require('crypto');
    const key = Buffer.from(keyHex, 'hex');
    const encrypted = downloadRes.body;
    const iv = encrypted.subarray(0, 12);
    const ciphertext = encrypted.subarray(12, encrypted.length - 16);
    const tag = encrypted.subarray(encrypted.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    assert.strictEqual(decrypted.length, 1024);

    // wait for process to exit
    const code = await new Promise(resolve => filedropProcess.on('exit', resolve));
    assert.strictEqual(code, 0, 'Process should exit with code 0 after successful transfer');
    assert.ok(output.includes(':8123/'), 'QR output or URL should be printed');
  });
});
