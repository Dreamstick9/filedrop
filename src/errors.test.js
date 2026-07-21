/**
 * Tests for the errors module and safeRun utility.
 */
const test = require('node:test');
const assert = require('node:assert');
const { 
  FileError, 
  NetworkError, 
  TransferError, 
  ConfigError, 
  ERROR_CODES 
 } = require('./errors.js');

test('Errors', async (t) => {
  await t.test('Each error class has correct code, message, exitCode', () => {
    const fileErr = new FileError(ERROR_CODES.ERR_FILE_NOT_FOUND, 'File not found');
    assert.strictEqual(fileErr.code, 'ERR_FILE_NOT_FOUND');
    assert.strictEqual(fileErr.message, 'File not found');
    assert.strictEqual(fileErr.exitCode, 4);
    assert.strictEqual(fileErr.name, 'FileError');

    const netErr = new NetworkError(ERROR_CODES.ERR_NO_INTERFACE, 'No interface');
    assert.strictEqual(netErr.code, 'ERR_NO_INTERFACE');
    assert.strictEqual(netErr.message, 'No interface');
    assert.strictEqual(netErr.exitCode, 2);

    const transErr = new TransferError(ERROR_CODES.ERR_TRANSFER_TIMEOUT, 'Timeout');
    assert.strictEqual(transErr.code, 'ERR_TRANSFER_TIMEOUT');
    assert.strictEqual(transErr.message, 'Timeout');
    assert.strictEqual(transErr.exitCode, 5);

    const configErr = new ConfigError(ERROR_CODES.ERR_INVALID_PORT, 'Invalid port');
    assert.strictEqual(configErr.code, 'ERR_INVALID_PORT');
    assert.strictEqual(configErr.message, 'Invalid port');
    assert.strictEqual(configErr.exitCode, 1);
  });
});
