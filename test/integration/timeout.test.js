/**
 * Integration test: Connection timeout
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createTempFile, cleanupTempFiles } = require('../helpers/create-temp-file.js');

test('Connection timeout integration', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('Exits with code 5 on timeout', async () => {
    try {
      require.resolve('../../src/cli.js');
    } catch {
      t.skip('cli.js not implemented yet');
      return;
    }

    const filePath = createTempFile(1024);
    const cliPath = path.join(__dirname, '../../src/cli.js');

    const filedropProcess = spawn(process.execPath, [cliPath, filePath, '--timeout', '2', '--no-mdns']);
    
    const code = await new Promise(resolve => filedropProcess.on('exit', resolve));
    assert.strictEqual(code, 5, 'Process should exit with code 5 after connection timeout');
  });
});
