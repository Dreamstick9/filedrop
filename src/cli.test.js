/**
 * Tests for CLI argument parsing.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('./cli.js');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('CLI Parser', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('Help text includes --qr / --no-qr flags', () => {
    const binPath = path.join(__dirname, '..', 'bin', 'filedrop.js');
    const stdout = execFileSync(process.execPath, [binPath, '--help']).toString();
    assert.match(stdout, /--qr \/ --no-qr/);
  });

  await t.test('Parses custom rate limit options', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--rate-limit-window',
      '2500',
      '--rate-limit-max',
      '7'
    ]);

    assert.strictEqual(config.rateLimitWindow, 2500);
    assert.strictEqual(config.rateLimitMax, 7);
  });

  await t.test('Parses custom --shutdown-grace-ms option', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--shutdown-grace-ms',
      '5000'
    ]);

    assert.strictEqual(config.shutdownGraceMs, 5000);
  });

  await t.test('--shutdown-grace-ms defaults to 10000 when not provided', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath
    ]);

    assert.strictEqual(config.shutdownGraceMs, 10000);
  });
});
