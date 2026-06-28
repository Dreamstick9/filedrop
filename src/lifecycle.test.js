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

  await t.test('emits shutdown-error when mdns.deregister times out', async () => {
  const errors = [];

  const lm = new LifecycleManager({
    mdns: {
      deregister() {
        return new Promise(() => {}); // never resolves
      }
    }
  });

  lm.on('shutdown-error', (event) => {
    errors.push(event);
  });

  if (process.stderr) {
    t.mock.method(process.stderr, 'write', () => true);
  }

  await lm.exitCleanly(0);

  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].phase, 'mdns.deregister');
  assert.ok(errors[0].error instanceof Error);
});

  await t.test('emits shutdown-error when server.shutdown times out', async () => {
  const errors = [];

  const lm = new LifecycleManager({
    server: {
      shutdown() {
        return new Promise(() => {}); // never resolves
      }
    }
  });

  lm.on('shutdown-error', (event) => {
    errors.push(event);
  });

  if (process.stderr) {
    t.mock.method(process.stderr, 'write', () => true);
  }

  await lm.exitCleanly(0);

  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].phase, 'server.shutdown');
  assert.ok(errors[0].error instanceof Error);
});
});
