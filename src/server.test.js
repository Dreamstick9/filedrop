/**
 * Tests for the ephemeral HTTP server module.
 */
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('./server.js');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { httpClient } = require('../test/helpers/http-client.js');

test('Server Core', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('Root returns 302 redirect to login if no auth cookie', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      options: { pin: '1234' },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    
    // We expect a 302 redirect to /login
    const res = await httpClient(url);
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.location, '/login');

    await shutdown();
  });

  await t.test('Login accepts correct PIN and sets cookies', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      options: { pin: '4321' },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/login`;
    
    const postData = 'pin=4321';
    
    const res = await httpClient(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    assert.strictEqual(res.statusCode, 302);
    assert.ok(res.headers['set-cookie']);
    assert.ok(res.headers['set-cookie'].some(c => c.startsWith('auth=')));
    assert.ok(res.headers['set-cookie'].some(c => c.startsWith('deviceId=')));

    await shutdown();
  });

  await t.test('Login rejects incorrect PIN', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      options: { pin: '4321' },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/login`;
    
    const postData = 'pin=0000';

    const res = await httpClient(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    assert.strictEqual(res.statusCode, 401);

    await shutdown();
  });

  await t.test('Authenticating and fetching file works', async () => {
    const filePath = createTempFile(1024, '.txt');
    let transferCompleted = false;

    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      options: { pin: '1111', limit: 1 },
      onTransferComplete: () => { transferCompleted = true; },
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    
    // 1. Login
    const loginRes = await httpClient(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 8
      }
    }, 'pin=1111');

    const cookies = loginRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');

    // 2. Fetch File
    const fileRes = await httpClient(`http://127.0.0.1:${port}/`, {
      headers: {
        'Cookie': cookies
      }
    });

    assert.strictEqual(fileRes.statusCode, 200);
    assert.strictEqual(fileRes.headers['content-length'], '1024');
    assert.ok(fileRes.headers['content-disposition'].includes('attachment'));
    assert.strictEqual(fileRes.body.length, 1024);

    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(transferCompleted, true);

    await shutdown();
  });

  await t.test('Second attempt to download file with same device returns 410', async () => {
     const filePath = createTempFile(1024, '.txt');
    let transferCompleted = false;

    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      options: { pin: '1111', limit: 5 }, // generous limit, but same device should be blocked
      onTransferComplete: () => { transferCompleted = true; },
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    
    const loginRes = await httpClient(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 8
      }
    }, 'pin=1111');

    const cookies = loginRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');

    const fileRes1 = await httpClient(`http://127.0.0.1:${port}/`, {
      headers: { 'Cookie': cookies }
    });
    assert.strictEqual(fileRes1.statusCode, 200);
    
    // Attempt second download with SAME device cookie
    const fileRes2 = await httpClient(`http://127.0.0.1:${port}/`, {
      headers: { 'Cookie': cookies }
    });
    assert.strictEqual(fileRes2.statusCode, 410);

    await shutdown();
  });

  await t.test('Unknown path returns 404', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, start, shutdown } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    await start();
    const port = server.address().port;
    const res = await httpClient(`http://127.0.0.1:${port}/unknown-path`);

    assert.strictEqual(res.statusCode, 404);
    await shutdown();
  });
});
