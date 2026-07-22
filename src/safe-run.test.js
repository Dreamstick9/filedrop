/**
 * Tests for the safeRun utility.
 */
const test = require('node:test');
const assert = require('node:assert');
const { safeRun } = require('./safe-run.js');

test('safeRun Utility', async (t) => {
  // Test case 1: The happy path
  await t.test('safeRun runs successfully and logs nothing on success', async () => {
    const originalError = console.error;
    let loggedMessage = '';
    console.error = (msg) => { loggedMessage += msg; };

    let called = false;
    await safeRun(async () => {
      called = true;
    }, 'SuccessLabel');

    console.error = originalError;

    assert.strictEqual(called, true, 'The function should be called');
    assert.strictEqual(loggedMessage, '', 'Nothing should be logged to console.error on success');
  });

  // Test case 2: The error path
  await t.test('safeRun catches errors and logs a warning to stderr', async () => {
    const originalError = console.error;
    let loggedMessage = '';
    console.error = (msg) => { loggedMessage += msg + '\n'; };

    await safeRun(async () => {
      throw new Error('Test error');
    }, 'TestLabel');

    console.error = originalError;

    assert.ok(loggedMessage.includes('Warning: error during TestLabel'), 'Should log warning to stderr');
    assert.ok(loggedMessage.includes('Test error'), 'Should include the error message');
  });

  // Test case 3: The debug path
  await t.test('safeRun logs the error stack trace to stderr when FILEDROP_DEBUG is set', async () => {
    const originalError = console.error;
    let loggedMessage = '';
    console.error = (msg) => { loggedMessage += msg + '\n'; };

    // Set the debug environment variable
    const originalDebug = process.env.FILEDROP_DEBUG;
    process.env.FILEDROP_DEBUG = '1';

    const testError = new Error('Test error with stack');

    await safeRun(async () => {
      throw testError;
    }, 'DebugLabel');

    // Clean up environment variable and restore console.error
    if (originalDebug === undefined) {
      delete process.env.FILEDROP_DEBUG;
    } else {
      process.env.FILEDROP_DEBUG = originalDebug;
    }
    console.error = originalError;

    assert.ok(loggedMessage.includes('Warning: error during DebugLabel'), 'Should log warning to stderr');
    assert.ok(loggedMessage.includes('Test error with stack'), 'Should include the error message');
    assert.ok(loggedMessage.includes(testError.stack), 'Should include the error stack trace when debug is enabled');
  });
});
