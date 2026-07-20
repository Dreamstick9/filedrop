/**
 * Tests for the platform detection utilities.
 */
const test = require('node:test');
const assert = require('node:assert');
const { 
  isWindows, 
  isMac, 
  isLinux, 
  isInteractiveTTY, 
  supportsAnsi, 
  supportsUnicode 
} = require('./platform.js');

test('Platform Utilities', async (t) => {
  // Helper to stub process.platform
  function stubPlatform(t, val) {
    if (!('__originalPlatform' in t)) {
      t.__originalPlatform = process.platform;
      t.after(() => {
        Object.defineProperty(process, 'platform', {
          value: t.__originalPlatform,
          writable: true,
          configurable: true
        });
      });
    }

    Object.defineProperty(process, 'platform', {
      value: val,
      writable: true,
      configurable: true
    });
  }

  // Helper to stub process.stdout.isTTY
  function stubIsTTY(t, val) {
    const hasStdout = !!process.stdout;
    let originalIsTTY;
    if (hasStdout) {
      originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = val;
    }
    t.after(() => {
      if (hasStdout) {
        process.stdout.isTTY = originalIsTTY;
      }
    });
  }

  // Helper to stub specific environment variables
  function stubEnv(t, vars) {
    const originalEnv = {};
    for (const key of Object.keys(vars)) {
      originalEnv[key] = process.env[key];
      if (vars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = vars[key];
      }
    }
    t.after(() => {
      for (const key of Object.keys(vars)) {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      }
    });
  }

  // --- tests for isWindows ---
  await t.test('isWindows returns true only on win32', (t) => {
    stubPlatform(t, 'win32');
    assert.strictEqual(isWindows(), true);
    assert.strictEqual(isMac(), false);
    assert.strictEqual(isLinux(), false);
  });

  // --- tests for isMac ---
  await t.test('isMac returns true only on darwin', (t) => {
    stubPlatform(t, 'darwin');
    assert.strictEqual(isWindows(), false);
    assert.strictEqual(isMac(), true);
    assert.strictEqual(isLinux(), false);
  });

  // --- tests for isLinux ---
  await t.test('isLinux returns true only on linux', (t) => {
    stubPlatform(t, 'linux');
    assert.strictEqual(isWindows(), false);
    assert.strictEqual(isMac(), false);
    assert.strictEqual(isLinux(), true);
  });

  // --- tests for other platforms ---
  await t.test('isWindows, isMac, and isLinux return false on other platforms', (t) => {
    stubPlatform(t, 'freebsd');
    assert.strictEqual(isWindows(), false);
    assert.strictEqual(isMac(), false);
    assert.strictEqual(isLinux(), false);
  });

  // --- tests for isInteractiveTTY ---
  await t.test('isInteractiveTTY returns true when stdout.isTTY is true', (t) => {
    stubIsTTY(t, true);
    assert.strictEqual(isInteractiveTTY(), true);
  });

  await t.test('isInteractiveTTY returns false when stdout.isTTY is not true', (t) => {
    stubIsTTY(t, false);
    assert.strictEqual(isInteractiveTTY(), false);
    
    stubIsTTY(t, undefined);
    assert.strictEqual(isInteractiveTTY(), false);
  });

  // --- tests for supportsAnsi ---
  await t.test('supportsAnsi returns false if NO_COLOR is in process.env', (t) => {
    stubEnv(t, { NO_COLOR: '', FORCE_COLOR: '1' });
    stubIsTTY(t, true);
    assert.strictEqual(supportsAnsi(), false);
  });

  await t.test('supportsAnsi returns false if TERM is dumb', (t) => {
    stubEnv(t, { NO_COLOR: undefined, TERM: 'dumb', FORCE_COLOR: '1' });
    stubIsTTY(t, true);
    assert.strictEqual(supportsAnsi(), false);
  });

  await t.test('supportsAnsi returns true if FORCE_COLOR is in process.env', (t) => {
    stubEnv(t, { NO_COLOR: undefined, TERM: 'xterm', FORCE_COLOR: '1' });
    stubIsTTY(t, false);
    assert.strictEqual(supportsAnsi(), true);
  });

  await t.test('supportsAnsi on Windows detects support based on WT_SESSION, TERM_PROGRAM, or TERM', (t) => {
    stubPlatform(t, 'win32');
    
    // WT_SESSION set
    stubEnv(t, { NO_COLOR: undefined, TERM: undefined, FORCE_COLOR: undefined, WT_SESSION: '123', TERM_PROGRAM: undefined });
    assert.strictEqual(supportsAnsi(), true);

    // TERM_PROGRAM=vscode
    stubEnv(t, { NO_COLOR: undefined, TERM: undefined, FORCE_COLOR: undefined, WT_SESSION: undefined, TERM_PROGRAM: 'vscode' });
    assert.strictEqual(supportsAnsi(), true);

    // TERM=xterm-256color
    stubEnv(t, { NO_COLOR: undefined, TERM: 'xterm-256color', FORCE_COLOR: undefined, WT_SESSION: undefined, TERM_PROGRAM: undefined });
    assert.strictEqual(supportsAnsi(), true);

    // None set on Windows
    stubEnv(t, { NO_COLOR: undefined, TERM: 'unknown', FORCE_COLOR: undefined, WT_SESSION: undefined, TERM_PROGRAM: undefined });
    assert.strictEqual(supportsAnsi(), false);
  });

  await t.test('supportsAnsi on non-Windows returns isInteractiveTTY()', (t) => {
    stubPlatform(t, 'linux');
    stubEnv(t, { NO_COLOR: undefined, TERM: 'xterm', FORCE_COLOR: undefined });

    stubIsTTY(t, true);
    assert.strictEqual(supportsAnsi(), true);

    stubIsTTY(t, false);
    assert.strictEqual(supportsAnsi(), false);
  });

  // --- tests for supportsUnicode ---
  await t.test('supportsUnicode on Windows returns true only if WT_SESSION or TERM_PROGRAM=vscode is set', (t) => {
    stubPlatform(t, 'win32');

    // WT_SESSION set
    stubEnv(t, { WT_SESSION: '123', TERM_PROGRAM: undefined });
    assert.strictEqual(supportsUnicode(), true);

    // TERM_PROGRAM=vscode
    stubEnv(t, { WT_SESSION: undefined, TERM_PROGRAM: 'vscode' });
    assert.strictEqual(supportsUnicode(), true);

    // Neither
    stubEnv(t, { WT_SESSION: undefined, TERM_PROGRAM: undefined });
    assert.strictEqual(supportsUnicode(), false);
  });

  await t.test('supportsUnicode on non-Windows returns false if TERM is dumb', (t) => {
    stubPlatform(t, 'linux');
    stubEnv(t, { TERM: 'dumb' });
    assert.strictEqual(supportsUnicode(), false);
  });

  await t.test('supportsUnicode on non-Windows returns true if TERM is not dumb', (t) => {
    stubPlatform(t, 'linux');
    stubEnv(t, { TERM: 'xterm-256color' });
    assert.strictEqual(supportsUnicode(), true);

    stubPlatform(t, 'darwin');
    stubEnv(t, { TERM: 'xterm' });
    assert.strictEqual(supportsUnicode(), true);
  });
});
