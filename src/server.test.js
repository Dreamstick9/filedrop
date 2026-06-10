/**
 * Tests for the ephemeral HTTP server module (v2.0 Architecture).
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createServer } = require('./server.js');
const { createTempFile, cleanupTempFiles } = require('../test/helpers/create-temp-file.js');
const { httpClient } = require('../test/helpers/http-client.js');

test('Server Core', async (t) => {
  t.afterEach(cleanupTempFiles);

  await t.test('GET / returns HTML payload', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    const res = await httpClient(url);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(res.body.toString().includes('<!DOCTYPE html>'));

    await shutdown();
  });

  await t.test('GET downloadPath returns encrypted file', async () => {
    const filePath = createTempFile(1024, '.txt');
    let transferCompleted = false;

    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => { transferCompleted = true; },
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;
    const res = await httpClient(url);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'application/octet-stream');
    assert.strictEqual(res.headers['content-length'], String(1024 + 28)); // 1024 + IV(12) + AuthTag(16)
    assert.ok(res.headers['content-disposition'].includes('attachment'));
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.strictEqual(res.body.length, 1024 + 28);

    await new Promise(r => setTimeout(r, 50)); // let socket close event fire
    assert.strictEqual(transferCompleted, true);

    await shutdown();
  });

  await t.test('HEAD downloadPath returns headers, no body', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;
    const res = await httpClient(url, { method: 'HEAD' });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-length'], String(1024 + 28));
    assert.strictEqual(res.body.length, 0);

    await shutdown();
  });

  await t.test('Unknown path returns 404', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const res = await httpClient(`http://127.0.0.1:${port}/unknown-path`);

    assert.strictEqual(res.statusCode, 404);
    await shutdown();
  });

  await t.test('Non-GET/HEAD returns 405', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const res = await httpClient(`http://127.0.0.1:${port}/`, { method: 'POST' });

    assert.strictEqual(res.statusCode, 405);
    await shutdown();
  });

  await t.test('Second GET on downloadPath returns 410', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;

    const res1 = await httpClient(url);
    assert.strictEqual(res1.statusCode, 200);

    const res2 = await httpClient(url);
    assert.strictEqual(res2.statusCode, 410);

    await shutdown();
  });
});
