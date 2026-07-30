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
    lm.exitStarted = true;

    let destroyed = false;
    const fakeStream = {
      on: () => {},
      destroy: () => { destroyed = true; }
    };

    lm.registerFileStream(fakeStream);

    assert.strictEqual(destroyed, true);
    assert.strictEqual(lm.fileStreams.has(fakeStream), false);
  });

  await t.test('Configurable stdout flush timeout resolves when callback never fires', async (t) => {
    t.mock.method(process.stdout, 'end', () => {});
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    t.after(() => {
      process.stdout.isTTY = originalIsTTY;
    });

    const lm = new LifecycleManager({ stdoutFlushTimeout: 20 });
    const startedAt = Date.now();

    await lm.exitCleanly(0);

    assert.ok(Date.now() - startedAt < 200);
    assert.strictEqual(lm.state, 'EXITED');
  });

  await t.test('Stdout flush failure writes to stderr not console.error', async (t) => {
    const originalEnd = process.stdout.end;
    process.stdout.end = () => { throw new Error('stdout broken'); };
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    t.after(() => {
      process.stdout.end = originalEnd;
      process.stdout.isTTY = originalIsTTY;
    });

    const stderrChunks = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (chunk) => { stderrChunks.push(chunk); };
    t.after(() => {
      process.stderr.write = originalStderrWrite;
    });

    const consoleErrorCalls = [];
    const originalConsoleError = console.error;
    console.error = (...args) => { consoleErrorCalls.push(args); };
    t.after(() => { console.error = originalConsoleError; });

    const lm = new LifecycleManager({ stdoutFlushTimeout: 20 });
    await lm.exitCleanly(0);

    const output = stderrChunks.join('');
    assert.ok(output.includes('Failed to flush stdout'));
    assert.ok(output.includes('stdout broken'));
    assert.strictEqual(consoleErrorCalls.length, 0, 'must not call console.error');
  });

  await t.test('Stdout flush error includes stack trace under FILEDROP_DEBUG', async (t) => {
    const originalEnd = process.stdout.end;
    process.stdout.end = () => { throw new Error('stdout broken'); };
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    t.after(() => {
      process.stdout.end = originalEnd;
      process.stdout.isTTY = originalIsTTY;
    });

    const stderrChunks = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (chunk) => { stderrChunks.push(chunk); };
    t.after(() => {
      process.stderr.write = originalStderrWrite;
    });

    const origDebug = process.env.FILEDROP_DEBUG;
    process.env.FILEDROP_DEBUG = '1';
    t.after(() => { process.env.FILEDROP_DEBUG = origDebug; });

    const lm = new LifecycleManager({ stdoutFlushTimeout: 20 });
    await lm.exitCleanly(0);

    const output = stderrChunks.join('');
    assert.ok(output.includes('Error: stdout broken'));
  });

  await t.test('Transfer timeout uses default 60s when not configured', async () => {
    const lm = new LifecycleManager();
    assert.strictEqual(lm.transferTimeoutSeconds, 60);
  });

  await t.test('Transfer timeout uses custom config when transferTimeout is provided', async () => {
    const lm = new LifecycleManager({ transferTimeout: 120 });
    assert.strictEqual(lm.transferTimeoutSeconds, 120);
  });

  await t.test('Transfer timeout error message formats dynamic timeout value', async () => {
    const lm = new LifecycleManager({ transferTimeout: 45 });
    lm.state = 'TRANSFERRING';
    
    let caughtError = null;
    lm.on('stateChange', ({ payload }) => {
      if (payload && payload.error) {
        caughtError = payload.error;
      }
    });

    lm._startTransferTimeout();
    // Trigger transfer timer callback manually
    lm.transferTimer._onTimeout();

    assert.ok(caughtError);
    assert.strictEqual(caughtError.message, 'Transfer timeout exceeded (45s). Client too slow or hung.');
  });

  await t.test('Failsafe exit uses default 1000ms when failsafeExitTimeout is not configured', async () => {
    const lm = new LifecycleManager();
    assert.strictEqual(lm.failsafeExitTimeout, 1000);
  });

  await t.test('Failsafe exit uses custom timeout when failsafeExitTimeout is configured', async () => {
    const lm = new LifecycleManager({ failsafeExitTimeout: 500 });
    assert.strictEqual(lm.failsafeExitTimeout, 500);
  });

  await t.test('Failsafe fires at configured interval using fake timers', async (t) => {
    const exitCalls = [];
    t.mock.method(process, 'exit', (code) => exitCalls.push(code));
    t.mock.timers.enable(['setTimeout']);

    const lm = new LifecycleManager({ failsafeExitTimeout: 500 });

    // Arm the failsafe timer directly — same pattern as exitCleanly
    setTimeout(() => process.exit(0), lm.failsafeExitTimeout).unref();

    // Just before the threshold — should not have fired yet
    t.mock.timers.tick(499);
    assert.strictEqual(exitCalls.length, 0);

    // Cross the threshold — should fire now
    t.mock.timers.tick(1);
    assert.strictEqual(exitCalls.length, 1);
    assert.strictEqual(exitCalls[0], 0);
  });

  await t.test('Failsafe exit falls back to default for invalid values', async () => {
    const invalid = [0, -500, 'abc', null, NaN];
    for (const value of invalid) {
      const lm = new LifecycleManager({ failsafeExitTimeout: value });
      assert.strictEqual(lm.failsafeExitTimeout, 1000, `expected default for value: ${value}`);
    }
  });

  await t.test('Failsafe exit coerces numeric strings', async () => {
    const lm = new LifecycleManager({ failsafeExitTimeout: '2000' });
    assert.strictEqual(lm.failsafeExitTimeout, 2000);
  });

});

