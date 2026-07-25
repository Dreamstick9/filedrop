/**
 * src/transport.test.js
 * Tests for transport selection policy, LanTransport contract, and signaling orchestration.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const { LanTransport, pickTransport } = require('./transport.js');
const { SignalingRoom } = require('./signaling.js');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');

test.afterEach(() => {
  cleanupTempFiles();
});

test('LanTransport Contract & Implementation', async (t) => {
  await t.test('LanTransport start() wraps server.createServer and returns transport contract shape', async () => {
    const fileContent = 'LanTransport Test Content';
    const filePath = createTempFile(fileContent.length, '.txt');
    fs.writeFileSync(filePath, fileContent);

    const transport = new LanTransport();
    let startEventFired = false;

    transport.on('transfer-start', (data) => {
      startEventFired = true;
    });

    const handle = await transport.start({
      filePath,
      port: 0,
      ip: '127.0.0.1',
      token: 'secret-token-123'
    });

    assert.strictEqual(handle.transportId, 'lan');
    assert.ok(typeof handle.keyHex === 'string' && handle.keyHex.length > 0);
    assert.ok(handle.shareUrl.includes('127.0.0.1'));
    assert.ok(handle.shareUrl.includes('?t=secret-token-123'));
    assert.ok(handle.shareUrl.includes(`#${handle.keyHex}`));
    assert.ok(typeof handle.shutdown === 'function');

    await handle.shutdown();
  });

  await t.test('LanTransport shutdown() closes the HTTP server cleanly', async () => {
    const filePath = createTempFile(1024, '.txt');
    const transport = new LanTransport();

    const handle = await transport.start({
      filePath,
      port: 0,
      ip: '127.0.0.1'
    });

    await assert.doesNotReject(async () => {
      await handle.shutdown();
    });
  });
});

test('pickTransport Policy Selection', async (t) => {
  
  await t.test('Step 1: forceMesh selects mesh when mesh is true and signalUrl is present', async () => {
    const result = await pickTransport({ mesh: true, signalUrl: 'ws://localhost' });
    assert.strictEqual(result, 'mesh');
  });

  await t.test('Step 1: forceMesh throws when signalUrl is missing', async () => {
    await assert.rejects(
      async () => {
        await pickTransport({ mesh: true });
      },
      /Cannot force Mesh: signaling URL is required/
    );
  });

  await t.test('Step 2: forceLan selects lan when mesh is false', async () => {
    const result = await pickTransport({ mesh: false });
    assert.strictEqual(result, 'lan');
  });

  await t.test('Step 3: peers present selects lan when mdns has peer found', async () => {
    const mockMdns = {
      hasPeerFound: () => true
    };
    const result = await pickTransport({ mdns: mockMdns });
    assert.strictEqual(result, 'lan');
  });

  await t.test('Step 4: no mdns peer with signal URL falls back to mesh after timeout', async () => {
    const mockMdns = new EventEmitter();
    mockMdns.hasPeerFound = () => false;

    const start = Date.now();
    const result = await pickTransport({
      signalUrl: 'ws://mock-signal',
      mdns: mockMdns,
      timeoutMs: 100 // Short timeout for testing speed
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(result, 'mesh');
    assert.ok(elapsed >= 90, `Should have waited at least 100ms, elapsed: ${elapsed}`);
  });

  await t.test('Step 4: mid-boot peer arrival selects lan immediately', async () => {
    const mockMdns = new EventEmitter();
    mockMdns.hasPeerFound = () => false;

    // Simulate mid-boot peer discovery
    setTimeout(() => {
      mockMdns.emit('peer-found');
    }, 50);

    const start = Date.now();
    const result = await pickTransport({
      signalUrl: 'ws://mock-signal',
      mdns: mockMdns,
      timeoutMs: 300
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(result, 'lan');
    assert.ok(elapsed < 200, `Should have resolved early when peer arrived, elapsed: ${elapsed}`);
  });

  await t.test('Step 5: default LAN selects lan when no signal URL is present', async () => {
    const mockMdns = {
      hasPeerFound: () => false
    };
    const result = await pickTransport({ mdns: mockMdns });
    assert.strictEqual(result, 'lan');
  });

});

test('Signaling Room Teardown', async (t) => {
  await t.test('SignalingRoom join and leave change state correctly', async () => {
    const room = new SignalingRoom('ws://signal-url', 'test-room');
    assert.strictEqual(room.joined, false);
    assert.strictEqual(room.closed, false);

    await room.join();
    assert.strictEqual(room.joined, true);
    assert.strictEqual(room.closed, false);

    await room.leave();
    assert.strictEqual(room.joined, false);
    assert.strictEqual(room.closed, true);
  });
});
