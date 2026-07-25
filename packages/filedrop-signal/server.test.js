/**
 * packages/filedrop-signal/server.test.js
 * Unit and integration tests for @dreamstick/filedrop-signal WebSocket server.
 */
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer, stopServer, rooms } = require('./server.js');

test('@dreamstick/filedrop-signal Server', async (t) => {
  let server;
  let signalUrl;

  t.beforeEach(async () => {
    server = await startServer(0, '127.0.0.1');
    const port = server.address().port;
    signalUrl = `ws://127.0.0.1:${port}`;
  });

  t.afterEach(async () => {
    await stopServer();
  });

  await t.test('Peer join, signal forwarding, and peer-joined notifications', async () => {
    const ws1 = new WebSocket(signalUrl);
    const ws2 = new WebSocket(signalUrl);
    const roomId = 'TEST01';

    const ws1Messages = [];
    const ws2Messages = [];

    const ws1Promise = new Promise((resolve) => {
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws1Messages.push(msg);
        if (msg.type === 'signal') resolve();
      });
    });

    const ws2Promise = new Promise((resolve) => {
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws2Messages.push(msg);
        if (msg.type === 'peer-joined') {
          // Peer 2 sends a signal back to Peer 1
          ws2.send(JSON.stringify({
            type: 'signal',
            room: roomId,
            payload: { sdp: 'offer-payload-sdp-test' }
          }));
          resolve();
        }
      });
    });

    await new Promise((resolve) => ws1.on('open', resolve));
    ws1.send(JSON.stringify({ type: 'join', room: roomId, role: 'sender' }));

    await new Promise((resolve) => ws2.on('open', resolve));
    ws2.send(JSON.stringify({ type: 'join', room: roomId, role: 'receiver' }));

    await Promise.all([ws1Promise, ws2Promise]);

    assert.ok(ws1Messages.some(m => m.type === 'join-result' && m.success === true));
    assert.ok(ws2Messages.some(m => m.type === 'join-result' && m.success === true));
    assert.ok(ws1Messages.some(m => m.type === 'peer-joined'));
    assert.ok(ws1Messages.some(m => m.type === 'signal' && m.payload && m.payload.sdp === 'offer-payload-sdp-test'));

    ws1.close();
    ws2.close();
  });

  await t.test('Rejects 3rd peer with ROOM_FULL when room capacity (2) is reached', async () => {
    const ws1 = new WebSocket(signalUrl);
    const ws2 = new WebSocket(signalUrl);
    const ws3 = new WebSocket(signalUrl);
    const roomId = 'FULL01';

    await new Promise((resolve) => ws1.on('open', resolve));
    ws1.send(JSON.stringify({ type: 'join', room: roomId, role: 'sender' }));

    await new Promise((resolve) => ws2.on('open', resolve));
    ws2.send(JSON.stringify({ type: 'join', room: roomId, role: 'receiver' }));

    await new Promise((resolve) => ws3.on('open', resolve));

    const errPromise = new Promise((resolve) => {
      ws3.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'ROOM_FULL') {
          resolve(msg);
        }
      });
    });

    ws3.send(JSON.stringify({ type: 'join', room: roomId }));

    const errMsg = await errPromise;
    assert.strictEqual(errMsg.code, 'ROOM_FULL');

    ws1.close();
    ws2.close();
    ws3.close();
  });

  await t.test('Rejects signaling message exceeding 64 KiB with PAYLOAD_TOO_LARGE', async () => {
    const ws = new WebSocket(signalUrl);
    const roomId = 'LARGE01';

    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'join', room: roomId }));

    const largePayload = 'A'.repeat(65 * 1024); // 65 KiB payload > 64 KiB
    const errPromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'PAYLOAD_TOO_LARGE') {
          resolve(msg);
        }
      });
    });

    ws.send(JSON.stringify({ type: 'signal', room: roomId, payload: largePayload }));

    const errMsg = await errPromise;
    assert.strictEqual(errMsg.code, 'PAYLOAD_TOO_LARGE');

    ws.close();
  });

  await t.test('Enforces per-peer rate limit with RATE_LIMITED error when flooded', async () => {
    const ws = new WebSocket(signalUrl);
    const roomId = 'FLOOD01';

    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'join', room: roomId }));

    let rateLimitedMsg = null;
    const rateLimitPromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'RATE_LIMITED') {
          rateLimitedMsg = msg;
          resolve();
        }
      });
    });

    // Send 60 messages instantly (limit is 50/sec)
    for (let i = 0; i < 60; i++) {
      ws.send(JSON.stringify({ type: 'signal', room: roomId, payload: `msg-${i}` }));
    }

    await rateLimitPromise;
    assert.ok(rateLimitedMsg);
    assert.strictEqual(rateLimitedMsg.code, 'RATE_LIMITED');

    ws.close();
  });

  await t.test('Cleans up room on leave and sends peer-left notification', async () => {
    const ws1 = new WebSocket(signalUrl);
    const ws2 = new WebSocket(signalUrl);
    const roomId = 'LEAVE01';

    await new Promise((resolve) => ws1.on('open', resolve));
    ws1.send(JSON.stringify({ type: 'join', room: roomId, role: 'sender' }));

    await new Promise((resolve) => ws2.on('open', resolve));
    ws2.send(JSON.stringify({ type: 'join', room: roomId, role: 'receiver' }));

    const peerLeftPromise = new Promise((resolve) => {
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'peer-left') {
          resolve(msg);
        }
      });
    });

    // Receiver sends leave
    ws2.send(JSON.stringify({ type: 'leave', room: roomId }));

    const leftMsg = await peerLeftPromise;
    assert.strictEqual(leftMsg.type, 'peer-left');

    ws1.close();
    ws2.close();
  });

  await t.test('Prevents unjoined socket from injecting signals into active room', async () => {
    const wsSender = new WebSocket(signalUrl);
    const wsAttacker = new WebSocket(signalUrl);
    const roomId = 'SEC01';

    let receivedSignal = false;
    wsSender.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'signal') receivedSignal = true;
    });

    await new Promise((resolve) => wsSender.on('open', resolve));
    wsSender.send(JSON.stringify({ type: 'join', room: roomId, role: 'sender' }));

    await new Promise((resolve) => wsAttacker.on('open', resolve));
    // Attacker has NOT joined SEC01, attempts to inject signal
    wsAttacker.send(JSON.stringify({ type: 'signal', room: roomId, payload: { injected: true } }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(receivedSignal, false, 'Unjoined socket signal must not be delivered');

    wsSender.close();
    wsAttacker.close();
  });

  await t.test('Prevents client from tearing down unjoined room via leave message', async () => {
    const wsSender = new WebSocket(signalUrl);
    const wsAttacker = new WebSocket(signalUrl);
    const targetRoom = 'SEC02';
    const attackerRoom = 'SEC03';

    let senderDisconnected = false;
    wsSender.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'error' && msg.message.includes('disconnected')) {
        senderDisconnected = true;
      }
    });

    await new Promise((resolve) => wsSender.on('open', resolve));
    wsSender.send(JSON.stringify({ type: 'join', room: targetRoom, role: 'sender' }));

    await new Promise((resolve) => wsAttacker.on('open', resolve));
    wsAttacker.send(JSON.stringify({ type: 'join', room: attackerRoom, role: 'sender' }));

    // Attacker tries to leave targetRoom (which it did NOT join)
    wsAttacker.send(JSON.stringify({ type: 'leave', room: targetRoom }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(senderDisconnected, false, 'Target room must not be torn down by non-member leave');

    wsSender.close();
    wsAttacker.close();
  });
});
