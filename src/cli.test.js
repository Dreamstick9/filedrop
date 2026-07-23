/**
 * Tests for CLI argument parsing.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('./cli.js');
const { MIN_PORT, MAX_PORT } = require('./port.js');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('CLI Parser', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('Help text includes --qr / --no-qr flags and --transfer-timeout', () => {
    const binPath = path.join(__dirname, '..', 'bin', 'filedrop.js');
    const stdout = execFileSync(process.execPath, [binPath, '--help']).toString();
    assert.match(stdout, /--qr \/ --no-qr/);
    assert.match(stdout, /--transfer-timeout/);
  });

  await t.test('Parses custom --transfer-timeout option and defaults to 60', () => {
    const filePath = createTempFile(1024, '.txt');
    const defaultConfig = parseArgs(['node', 'filedrop', filePath]);
    assert.strictEqual(defaultConfig.transferTimeout, 60);

    const customConfig = parseArgs(['node', 'filedrop', filePath, '--transfer-timeout', '120']);
    assert.strictEqual(customConfig.transferTimeout, 120);
  });

  await t.test('Fails on invalid --transfer-timeout option', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      parseArgs(['node', 'filedrop', filePath, '--transfer-timeout', 'invalid123']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--transfer-timeout must be a positive integer')));

      exitCode = null;
      errors = [];
      parseArgs(['node', 'filedrop', filePath, '--transfer-timeout', '-5']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--transfer-timeout must be a positive integer')));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
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


  await t.test('Parses valid --port option', () => {
    const filePath = createTempFile(1024, '.txt');
    
    // Test MIN_PORT
    let config = parseArgs(['node', 'filedrop', filePath, '--port', String(MIN_PORT)]);
    assert.strictEqual(config.port, MIN_PORT);

    // Test MAX_PORT
    config = parseArgs(['node', 'filedrop', filePath, '--port', String(MAX_PORT)]);
    assert.strictEqual(config.port, MAX_PORT);

    // Test custom port in range
    config = parseArgs(['node', 'filedrop', filePath, '--port', '8080']);
    assert.strictEqual(config.port, 8080);
  });

  await t.test('Fails on invalid --port option (out of bounds)', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      // Test below MIN_PORT
      parseArgs(['node', 'filedrop', filePath, '--port', String(MIN_PORT - 1)]);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes(`must be a valid integer between ${MIN_PORT} and ${MAX_PORT}`)));

      // Reset trackers
      exitCode = null;
      errors = [];

      // Test above MAX_PORT
      parseArgs(['node', 'filedrop', filePath, '--port', String(MAX_PORT + 1)]);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes(`must be a valid integer between ${MIN_PORT} and ${MAX_PORT}`)));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  await t.test('Fails on invalid --port option (non-integer)', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      parseArgs(['node', 'filedrop', filePath, '--port', 'not-a-number']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes(`must be a valid integer between ${MIN_PORT} and ${MAX_PORT}`)));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  await t.test('Parses custom token, connection limit, and sensitive warning options', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--token',
      'mysecret',
      '--max-connections',
      '5',
      '--no-warn-sensitive'
    ]);

    assert.strictEqual(config.token, 'mysecret');
    assert.strictEqual(config.maxConnections, 5);
    assert.strictEqual(config.warnSensitive, false);
  });

  await t.test('Generates random 16-character hex token when --token is present but empty', () => {
    const filePath = createTempFile(1024, '.txt');
    const config1 = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--token'
    ]);
    assert.strictEqual(typeof config1.token, 'string');
    assert.strictEqual(config1.token.length, 16);

    const config2 = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--token',
      '--max-connections',
      '8'
    ]);
    assert.strictEqual(typeof config2.token, 'string');
    assert.strictEqual(config2.token.length, 16);
    assert.strictEqual(config2.maxConnections, 8);

  });

  await t.test('Parses --mesh, --no-mesh, and --signal-url options', () => {
    const filePath = createTempFile(1024, '.txt');
    
    // 1. With --mesh and --signal-url
    const configMesh = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--mesh',
      '--signal-url',
      'ws://localhost'
    ]);
    assert.strictEqual(configMesh.mesh, true);
    assert.strictEqual(configMesh.signalUrl, 'ws://localhost');

    // 2. With --no-mesh
    const configNoMesh = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--no-mesh'
    ]);
    assert.strictEqual(configNoMesh.mesh, false);

    // 3. Without specifying mesh
    const configNoFlag = parseArgs([
      'node',
      'filedrop',
      filePath
    ]);
    assert.strictEqual(configNoFlag.mesh, undefined);

    // 4. With --signal-url
    const configSignal = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--signal-url',
      'ws://my-signaling-server.local'
    ]);
    assert.strictEqual(configSignal.signalUrl, 'ws://my-signaling-server.local');
  });

  await t.test('Fails when --mesh is specified without --signal-url', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      parseArgs(['node', 'filedrop', filePath, '--mesh']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--signal-url is required when using --mesh')));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  await t.test('Parses valid --download-limit option', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs(['node', 'filedrop', filePath, '--download-limit', '3']);
    assert.strictEqual(config.downloadLimit, 3);
  });

  await t.test('Fails on invalid --download-limit option (non-integer or <= 0)', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      parseArgs(['node', 'filedrop', filePath, '--download-limit', 'abc']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--download-limit must be a positive integer')));

      exitCode = null;
      errors = [];

      parseArgs(['node', 'filedrop', filePath, '--download-limit', '0']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--download-limit must be a positive integer')));

      exitCode = null;
      errors = [];

      parseArgs(['node', 'filedrop', filePath, '--download-limit', '-5']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('--download-limit must be a positive integer')));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  await t.test('Parses NAT relay options correctly', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath,
      '--no-relay',
      '--relay-password',
      'secret123',
      '--ice-timeout',
      '15'
    ]);

    assert.strictEqual(config.relay, false);
    assert.strictEqual(config.relayPassword, 'secret123');
    assert.strictEqual(config.iceTimeout, 15);
  });

  await t.test('Relay option defaults to true and ice-timeout defaults to 8', () => {
    const filePath = createTempFile(1024, '.txt');
    const config = parseArgs([
      'node',
      'filedrop',
      filePath
    ]);

    assert.strictEqual(config.relay, true);
    assert.strictEqual(config.relayPassword, null);
    assert.strictEqual(config.iceTimeout, 8);
  });

  await t.test('Fails on invalid --ice-timeout option (non-integer or negative)', () => {
    const filePath = createTempFile(1024, '.txt');
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode = null;
    let errors = [];

    process.exit = (code) => {
      exitCode = code;
    };
    console.error = (msg) => {
      errors.push(msg);
    };

    try {
      parseArgs(['node', 'filedrop', filePath, '--ice-timeout', '-5']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('must be a positive integer')));

      exitCode = null;
      errors = [];

      parseArgs(['node', 'filedrop', filePath, '--ice-timeout', 'abc']);
      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some(err => err.includes('must be a positive integer')));
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });
});

