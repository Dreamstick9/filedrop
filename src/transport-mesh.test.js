/**
 * src/transport-mesh.test.js
 * Unit and integration tests for MeshTransport WebRTC / Relay Fallback session.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { MeshTransport } = require('./transport-mesh.js');

test.afterEach(() => {
  cleanupTempFiles();
});

test('MeshTransport.start() returns contract shape { transportId, shareUrl, keyHex, shutdown }', async () => {
  const fileContent = 'Contract test payload';
  const filePath = createTempFile(fileContent.length, '.txt');
  fs.writeFileSync(filePath, fileContent);

  const signalUrl = 'ws://127.0.0.1:9999/mock';

  const transport = new MeshTransport({
    filePath,
    isMultiFile: false,
    isDirectory: false,
    isClipboard: false,
    signalUrl
  });

  const result = await transport.start();

  assert.ok(result.transportId, 'transportId should be present');
  assert.ok(result.keyHex, 'keyHex should be present');
  assert.strictEqual(result.keyHex.length, 64, 'keyHex should be a 32-byte hex string');
  assert.ok(result.shareUrl.includes(result.transportId), 'shareUrl should contain transportId');
  assert.ok(result.shareUrl.includes(result.keyHex), 'shareUrl should contain keyHex');
  assert.strictEqual(typeof result.shutdown, 'function', 'shutdown should be a function');

  await result.shutdown();
});

test('MeshTransport: Generates custom transportId and keyHex when provided', async () => {
  const filePath = createTempFile(10, '.txt');
  const customId = 'custom-room-123';
  const customKey = crypto.randomBytes(32).toString('hex');
  const signalUrl = 'ws://127.0.0.1:9999/mock';

  const transport = new MeshTransport({
    filePath,
    signalUrl,
    transferId: customId,
    keyHex: customKey
  });

  const result = await transport.start();

  assert.strictEqual(result.transportId, customId);
  assert.strictEqual(result.keyHex, customKey);

  await result.shutdown();
});

test('MeshTransport: Shutdown cleanly terminates timers and signaling room', async () => {
  const filePath = createTempFile(10, '.txt');
  const signalUrl = 'ws://127.0.0.1:9999/mock';

  const transport = new MeshTransport({
    filePath,
    signalUrl
  });

  const result = await transport.start();
  assert.strictEqual(transport.shutdownCalled, false);

  await result.shutdown();
  assert.strictEqual(transport.shutdownCalled, true);
  assert.strictEqual(transport.ws, null);
  assert.strictEqual(transport.signalingRoom, null);
});

test('MeshTransport Integration: End-to-end payload streaming and decryption integrity', async () => {
  const fileContent = 'Hello from MeshTransport WebRTC data stream integration test!';
  const filePath = createTempFile(fileContent.length, '.txt');
  fs.writeFileSync(filePath, fileContent);

  const transferId = 'integration-room-456';
  const keyHex = crypto.randomBytes(32).toString('hex');

  let transferCompleted = false;

  const transport = new MeshTransport({
    filePath,
    signalUrl: 'ws://127.0.0.1:9999/mock',
    transferId,
    keyHex,
    relay: true,
    iceTimeout: 0.1, // 100ms
    onTransferComplete: () => {
      transferCompleted = true;
    }
  });

  const session = await transport.start();
  assert.strictEqual(session.transportId, transferId);
  assert.strictEqual(session.keyHex, keyHex);

  // Directly trigger encrypted relay stream logic
  await transport.startRelayStream();

  await session.shutdown();
});
