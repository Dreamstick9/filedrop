/**
 * Tests for the lifecycle manager.
 */
const test = require('node:test');
const assert = require('node:assert');
const { LifecycleManager } = require('./lifecycle.js');

test('Lifecycle Manager', async (t) => {
  t.mock.method(process, 'exit', () => {});
  if (process.stdout) {
    t.mock.method(process.stdout, 'end', (str, cb) => {
      if (typeof cb === 'function') cb();
      else if (typeof str === 'function') str();
    });
  }

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
      assert.strictEqual(lm.state, 'EXITED');
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
  await t.test('Streams registered after exitStarted are destroyed immediately', async () => {
    const lm = new LifecycleManager();
    lm.exitStarted = true; // simulate shutdown already begun

    let destroyed = false;
    const fakeStream = {
      on: () => {},
      destroy: () => { destroyed = true; }
    };

    lm.registerFileStream(fakeStream);

    assert.strictEqual(destroyed, true);
    assert.strictEqual(lm.fileStreams.has(fakeStream), false);
  });

});
