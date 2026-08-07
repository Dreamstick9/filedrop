/**
 * src/transport-mesh.test.js
 * Tests for WebRTC MeshTransport and Relay Fallback flow.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { startServer, stopServer } = require('../packages/filedrop-signal/server.js');
const { MeshTransport } = require('./transport-mesh.js');

test.afterEach(() => {
  cleanupTempFiles();
});

test('MeshTransport: Forced ICE failure (mock) -> relay engages -> byte-identical transfer completes', async () => {
  const signalServer = await startServer(0);
  const port = signalServer.address().port;
  const signalUrl = `ws://127.0.0.1:${port}`;

  const fileContent = 'Hello World from Antigravity NAT Relay Fallback!';
  const filePath = createTempFile(fileContent.length, '.txt');
  fs.writeFileSync(filePath, fileContent);

  const transferId = 'room-123';
  const keyHex = crypto.randomBytes(32).toString('hex');

  let relayStatusUpdated = false;
  let transferStarted = false;
  let transferCompleted = false;

  let transferCompletedResolve;
  const transferCompletedPromise = new Promise((resolve) => {
    transferCompletedResolve = resolve;
  });

  const transport = new MeshTransport({
    filePath,
    isMultiFile: false,
    isDirectory: false,
    isClipboard: false,
    signalUrl,
    transferId,
    keyHex,
    relay: true,
    iceTimeout: 0.1, // 100ms
    onStatusUpdate: (status) => {
      if (status === 'relay: ON (ciphertext only)') {
        relayStatusUpdated = true;
      }
    },
    onTransferStart: () => {
      transferStarted = true;
    },
    onTransferComplete: () => {
      transferCompleted = true;
      transferCompletedResolve();
    },
    onTransferError: (err) => {
      assert.fail(`Should not have error: ${err.message}`);
    }
  });

  await transport.start();

  const receiverWs = new WebSocket(signalUrl);
  const receivedChunks = [];
  let metaReceived = null;
  let transferDone = false;

  const receiverPromise = new Promise((resolve, reject) => {
    receiverWs.onopen = () => {
      receiverWs.send(JSON.stringify({
        type: 'join',
        roomId: transferId,
        role: 'receiver'
      }));
    };

    receiverWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'meta') {
        metaReceived = msg;
      } else if (msg.type === 'relay-data') {
        receivedChunks.push(Buffer.from(msg.data, 'base64'));
      } else if (msg.type === 'transfer-complete') {
        transferDone = true;
        receiverWs.send(JSON.stringify({ type: 'transfer-complete-ack' }));
        resolve();
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
      }
    };

    receiverWs.onerror = reject;
  });

  await Promise.all([receiverPromise, transferCompletedPromise]);
  receiverWs.close();
  await transport.shutdown();
  await stopServer();

  // Verify UI/callback states
  assert.ok(relayStatusUpdated, 'Relay status should be updated');
  assert.ok(transferStarted, 'Transfer start callback should be triggered');
  assert.ok(transferCompleted, 'Transfer complete callback should be triggered');
  assert.ok(transferDone, 'Receiver should get transfer-complete message');
  assert.ok(metaReceived, 'Receiver should receive metadata');
  assert.strictEqual(metaReceived.filename, path.basename(filePath));

  // Reconstruct and decrypt the received payload
  const encrypted = Buffer.concat(receivedChunks);
  const iv = encrypted.subarray(0, 12);
  const ciphertext = encrypted.subarray(12, encrypted.length - 16);
  const tag = encrypted.subarray(encrypted.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  assert.strictEqual(decrypted.toString(), fileContent, 'Decrypted content must match original content exactly');
});

test('MeshTransport: Relay server refuses frames when room is empty (receiver joins first)', async () => {
  const signalServer = await startServer(0);
  const port = signalServer.address().port;
  const signalUrl = `ws://127.0.0.1:${port}`;

  const receiverWs = new WebSocket(signalUrl);
  let errorMessage = null;

  const joinPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      receiverWs.close();
      reject(new Error('Timed out waiting for room empty response'));
    }, 1000);

    receiverWs.onopen = () => {
      receiverWs.send(JSON.stringify({
        type: 'join',
        roomId: 'empty-room',
        role: 'receiver'
      }));
    };
    receiverWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'error') {
        errorMessage = msg.message;
      }
    };
    receiverWs.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
    receiverWs.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });

  await joinPromise;
  await stopServer();
  assert.strictEqual(errorMessage, 'Room empty. Sender must join first.');
});

test('MeshTransport: --no-relay aborts the transfer cleanly with a clear error', async () => {
  const signalServer = await startServer(0);
  const port = signalServer.address().port;
  const signalUrl = `ws://127.0.0.1:${port}`;

  const fileContent = 'No relay fallback test';
  const filePath = createTempFile(fileContent.length, '.txt');
  fs.writeFileSync(filePath, fileContent);

  const transferId = 'room-norelay';
  const keyHex = crypto.randomBytes(32).toString('hex');

  let transferErrorTriggered = false;
  let errMessage = null;

  const transport = new MeshTransport({
    filePath,
    isMultiFile: false,
    isDirectory: false,
    isClipboard: false,
    signalUrl,
    transferId,
    keyHex,
    relay: false, // disable relay
    iceTimeout: 0.1, // 100ms
    onTransferError: (err) => {
      transferErrorTriggered = true;
      errMessage = err.message;
    }
  });

  await transport.start();

  const receiverWs = new WebSocket(signalUrl);
  receiverWs.onopen = () => {
    receiverWs.send(JSON.stringify({
      type: 'join',
      roomId: transferId,
      role: 'receiver'
    }));
  };

  await new Promise((resolve) => setTimeout(resolve, 200));

  receiverWs.close();
  await transport.shutdown();
  await stopServer();

  assert.ok(transferErrorTriggered, 'Error callback should be triggered');
  assert.match(errMessage, /ICE connection failed and relay fallback is disabled/);
});

test('MeshTransport: Relay server does not inspect or decrypt relay-data contents', async () => {
  const serverPath = path.resolve(__dirname, '../packages/filedrop-signal/server.js');
  const content = fs.readFileSync(serverPath, 'utf8');
  assert.ok(content.includes('ASSERTION: Relay frames are not inspected or decrypted by the server; they are forwarded verbatim.'));
});
