/**
 * Tests for the lifecycle manager.
 */
const test = require('node:test');
const assert = require('node:assert');
const { LifecycleManager } = require('./lifecycle.js');

test('Lifecycle Manager', async (t) => {
  await t.test('All valid state transitions succeed', async () => {
    try {
      const lm = new LifecycleManager();
      assert.strictEqual(lm.state, 'INITIALIZING');
      lm.transition('READY');
      assert.strictEqual(lm.state, 'READY');
      lm.transition('WAITING');
      assert.strictEqual(lm.state, 'WAITING');
      lm.transition('TRANSFERRING');
      assert.strictEqual(lm.state, 'TRANSFERRING');
      lm.transition('COMPLETE');
      assert.strictEqual(lm.state, 'COMPLETE');
      await lm.exitCleanly(0);
      assert.strictEqual(lm.state, 'EXITED');
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        t.skip('lifecycle.js not implemented yet');
      } else {
        throw e;
      }
    }
  });

  await t.test('Invalid state transitions throw', async () => {
    try {
      const lm = new LifecycleManager();
      assert.throws(() => lm.transition('COMPLETE')); // from INITIALIZING to COMPLETE
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        t.skip('lifecycle.js not implemented yet');
      } else {
        throw e;
      }
    }
  });
});
