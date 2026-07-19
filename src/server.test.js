/**
 * Tests for the ephemeral HTTP server module (v2.0 Architecture).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('./server.js');
const pkg = require('../package.json');
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
    assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(res.body.toString().includes('<!DOCTYPE html>'));

    await shutdown();
  });

  await t.test('GET / injects the detected MIME type for single-file transfers', async () => {
    const filePath = createTempFile(1024, '.pdf');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const htmlRes = await httpClient(`http://127.0.0.1:${port}/`);
    const downloadRes = await httpClient(`http://127.0.0.1:${port}${downloadPath}`);

    assert.match(htmlRes.body.toString(), /type: "application\/pdf"/);
    assert.strictEqual(downloadRes.headers['content-type'], 'application/pdf');

    await shutdown();
  });

  await t.test('GET downloadPath uses application/zip for directory downloads', async () => {
    const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'filedrop-dir-'));
    try {
      const nestedFilePath = path.join(dirPath, 'nested.txt');
      fs.writeFileSync(nestedFilePath, 'hello world');

      const { server, shutdown, downloadPath } = await createServer({
        filePath: dirPath,
        isDirectory: true,
        port: 0,
        onTransferComplete: () => {},
        onTransferError: () => {}
      });

      const port = server.address().port;
      const htmlRes = await httpClient(`http://127.0.0.1:${port}/`);
      const downloadRes = await httpClient(`http://127.0.0.1:${port}${downloadPath}`);

      assert.match(htmlRes.body.toString(), /type: "application\/zip"/);
      assert.strictEqual(downloadRes.headers['content-type'], 'application/zip');

      await shutdown();
    } finally {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  });

  await t.test('GET / injects text/plain for clipboard transfers', async () => {
    const { server, shutdown, downloadPath } = await createServer({
      clipboardData: 'clipboard content',
      isClipboard: true,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const htmlRes = await httpClient(`http://127.0.0.1:${port}/`);
    const downloadRes = await httpClient(`http://127.0.0.1:${port}${downloadPath}`);

    assert.match(htmlRes.body.toString(), /type: "text\/plain"/);
    assert.strictEqual(downloadRes.headers['content-type'], 'text/plain');

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
    assert.strictEqual(res.headers['content-type'], 'text/plain');
    assert.strictEqual(res.headers['content-length'], String(1024 + 28)); // 1024 + IV(12) + AuthTag(16)
    assert.ok(res.headers['content-disposition'].includes('attachment'));
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.strictEqual(res.body.length, 1024 + 28);

    await new Promise(r => setTimeout(r, 50)); // let socket close event fire
    assert.strictEqual(transferCompleted, true);

    await shutdown();
  });

  await t.test('GET downloadPath with Range header returns 200 and full content', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;
    const res = await httpClient(url, { headers: { 'Range': 'bytes=0-' } });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['accept-ranges'], 'none');
    assert.strictEqual(res.body.length, 1024 + 28);

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

  await t.test('X-Filedrop-Version header uses package version for download responses', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;

    const headRes = await httpClient(url, { method: 'HEAD', agent: false });
    assert.strictEqual(headRes.statusCode, 200);
    assert.strictEqual(headRes.headers['x-filedrop-version'], pkg.version);

    const getRes = await httpClient(url, { agent: false });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.headers['x-filedrop-version'], pkg.version);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const secondGetRes = await httpClient(url, { agent: false });
    assert.strictEqual(secondGetRes.statusCode, 410);
    assert.strictEqual(secondGetRes.headers['x-filedrop-version'], pkg.version);

    await shutdown();
  });

  await t.test('Immediate retry after client disconnect is rejected with 429', async () => {
    const filePath = createTempFile(1024 * 1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      options: {
        transferCleanupDelay: 200
      },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;

    const firstReq = http.get(url, (res) => {
      res.on('data', () => {
        firstReq.destroy();
      });
    });

    firstReq.on('error', () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    const retryRes = await httpClient(url, { agent: false });
    assert.strictEqual(retryRes.statusCode, 429);
    assert.strictEqual(retryRes.headers['retry-after'], '5');

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

  await t.test('Custom rate limit options control request threshold and retry header', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      options: {
        rateLimitWindow: 2000,
        rateLimitMax: 1
      },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/unknown-path`;

    const res1 = await httpClient(url);
    assert.strictEqual(res1.statusCode, 404);

    const res2 = await httpClient(url);
    assert.strictEqual(res2.statusCode, 429);
    assert.strictEqual(res2.headers['retry-after'], '2');

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

  await t.test('Transfer timeout: custom timeout triggers ERR_TRANSFER_TIMEOUT', async () => {
    const filePath = createTempFile(50 * 1024 * 1024, '.bin');
    let errorCalled = false;
    let errorPromiseResolve;
    const errorPromise = new Promise(r => errorPromiseResolve = r);

    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      options: {
        timeout: 0.1 // 100ms
      },
      onTransferComplete: () => {},
      onTransferError: (err) => {
        if (err.message === 'ERR_TRANSFER_TIMEOUT') {
          errorCalled = true;
          errorPromiseResolve();
        }
      }
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;

    const req = http.get(url, () => {
      // Keep open, do not consume
    });

    await errorPromise;
    assert.strictEqual(errorCalled, true);

    const retryRes = await httpClient(url, { agent: false });
    assert.strictEqual(retryRes.statusCode, 200);

    req.destroy();
    await shutdown();
  });

  await t.test('Transfer timeout: 0 disables timeout', async () => {
    const filePath = createTempFile(2 * 1024 * 1024, '.txt');
    let errorCalled = false;

    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      options: {
        timeout: 0
      },
      onTransferComplete: () => {},
      onTransferError: (err) => {
        if (err.message === 'ERR_TRANSFER_TIMEOUT') {
          errorCalled = true;
        }
      }
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${downloadPath}`;

    const req = http.get(url, () => {
      // Keep open, do not consume
    });

    await new Promise(resolve => setTimeout(resolve, 150));
    assert.strictEqual(errorCalled, false);
    req.destroy();
    await shutdown();
  });

  await t.test('Token protection: restricts access unless correct token is provided', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown, downloadPath } = await createServer({
      filePath,
      port: 0,
      options: {
        token: 'mysecret'
      },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;

    const res1 = await httpClient(`http://127.0.0.1:${port}/`);
    assert.strictEqual(res1.statusCode, 403);

    const res2 = await httpClient(`http://127.0.0.1:${port}/?t=wrong`);
    assert.strictEqual(res2.statusCode, 403);

    const res3 = await httpClient(`http://127.0.0.1:${port}/?t=mysecret`);
    assert.strictEqual(res3.statusCode, 200);

    const res4 = await httpClient(`http://127.0.0.1:${port}/forge.min.js`);
    assert.strictEqual(res4.statusCode, 200);

    const res5 = await httpClient(`http://127.0.0.1:${port}${downloadPath}`);
    assert.strictEqual(res5.statusCode, 403);

    const res6 = await httpClient(`http://127.0.0.1:${port}${downloadPath}?t=mysecret`);
    assert.strictEqual(res6.statusCode, 200);

    await shutdown();
  });

  await t.test('GET /forge.min.js resolves node-forge from a hoisted install', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filedrop-hoisted-'));
    const appRoot = path.join(fixtureRoot, 'app');
    const sourceRoot = path.join(appRoot, 'src');
    const projectRoot = path.resolve(__dirname, '..');

    try {
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(appRoot, 'package.json'));
      for (const file of ['server.js', 'constants.js', 'security.js']) {
        fs.copyFileSync(path.join(__dirname, file), path.join(sourceRoot, file));
      }
      fs.symlinkSync(
        path.join(projectRoot, 'node_modules'),
        path.join(fixtureRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      const hoistedServer = require(path.join(sourceRoot, 'server.js'));
      const filePath = createTempFile(1024, '.txt');
      const { server, shutdown } = await hoistedServer.createServer({
        filePath,
        port: 0,
        onTransferComplete: () => {},
        onTransferError: () => {}
      });

      try {
        const port = server.address().port;
        const response = await httpClient(`http://127.0.0.1:${port}/forge.min.js`);
        const expected = fs.readFileSync(require.resolve('node-forge/dist/forge.min.js'));

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.headers['content-type'], 'application/javascript');
        assert.deepStrictEqual(response.body, expected);
      } finally {
        await shutdown();
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  await t.test('Connection limiting: rejects connections beyond maxConnections', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      options: {
        maxConnections: 1
      },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    const port = server.address().port;

    const socket1 = new (require('net').Socket)();
    await new Promise((resolve, reject) => {
      socket1.once('error', reject);
      socket1.connect(port, '127.0.0.1', () => {
        socket1.removeListener('error', reject);
        resolve();
      });
    });

    const socket2 = new (require('net').Socket)();
    await new Promise((resolve, reject) => {
      socket2.once('error', reject);
      socket2.connect(port, '127.0.0.1', () => {
        socket2.removeListener('error', reject);
        resolve();
      });
    });
    
    let receivedData = '';
    socket2.on('data', (data) => {
      receivedData += data.toString();
    });

    socket2.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');

    await new Promise(resolve => {
      socket2.on('end', resolve);
      socket2.on('error', () => resolve());
      setTimeout(resolve, 500);
    });

    assert.ok(receivedData.includes('HTTP/1.1 429 Too Many Requests'), 'Second connection should be rejected with 429');

    socket1.destroy();
    socket2.destroy();
    await shutdown();
  });

  await t.test('Custom shutdownTimeoutMs controls the shutdown force-timeout', async () => {
    const filePath = createTempFile(1024, '.txt');
    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      options: {
        shutdownTimeoutMs: 200
      },
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    // Simulate a server.close() that never invokes its callback (e.g. a lingering
    // keep-alive socket), so shutdown() must fall back to the configured force-timeout.
    const originalClose = server.close.bind(server);
    server.close = () => {};

    const start = Date.now();
    await shutdown();
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 190, `expected shutdown to wait ~200ms, took ${elapsed}ms`);
    assert.ok(elapsed < 1000, `expected shutdown to resolve shortly after the custom timeout, took ${elapsed}ms`);

    // Actually release the underlying listener now that the timing assertion is done.
    await new Promise(resolve => originalClose(resolve));
  });

  await t.test('Decoded filename route matching: correctly resolves paths with spaces/special characters', async () => {
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, 'file name with space.txt');
    fs.writeFileSync(filePath, 'content');

    const { server, shutdown } = await createServer({
      filePath,
      port: 0,
      onTransferComplete: () => {},
      onTransferError: () => {}
    });

    try {
      const port = server.address().port;
      const res = await httpClient(`http://127.0.0.1:${port}/file%20name%20with%20space.txt`, { agent: false });
      assert.strictEqual(res.statusCode, 200);
    } finally {
      await shutdown();
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors.
      }
    }
  });


  await t.test('Content-Disposition filename sanitization', async () => {
    const maliciousNames = [
      { name: 'evil\r\nX-Test: injected.txt', expectedSafe: 'evilX-Test: injected.txt' },
      { name: 'hello"world.txt', expectedSafe: 'hello\\"world.txt' },
      { name: 'null\0byte.txt', expectedSafe: 'nullbyte.txt' },
      { name: 'control\x1Fchars.txt', expectedSafe: 'controlchars.txt' },
      { name: 'normal.txt', expectedSafe: 'normal.txt' },
      { name: 'hello\\world.txt', expectedSafe: 'hello\\\\world.txt' },
      { name: 'abc\\', expectedSafe: 'abc\\\\' }
    ];

    for (const { name, expectedSafe } of maliciousNames) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedrop-test-'));
      const dummyPath = path.join(tempDir, 'dummy_test_file.txt');
      fs.writeFileSync(dummyPath, 'content');
      
      const originalBasename = path.basename;
      path.basename = (p, ext) => p === dummyPath ? name : originalBasename(p, ext);
      
      let downloadPathForTest = '';
      let shutdownForTest = null;
      
      try {
        const { server, shutdown, downloadPath } = await createServer({
          filePath: dummyPath,
          port: 0,
          onTransferComplete: () => {},
          onTransferError: () => {}
        });
        shutdownForTest = shutdown;
        downloadPathForTest = downloadPath;
        
        const port = server.address().port;
        const cd = await new Promise((resolve, reject) => {
          const req = http.request(`http://127.0.0.1:${port}${downloadPathForTest}`, { method: 'HEAD', agent: false }, (res) => {
            res.resume();
            resolve(res.headers['content-disposition']);
          });
          req.on('error', reject);
          req.end();
        });
        
        // Assert filename="..." has sanitized value
        assert.ok(cd.includes(`filename="${expectedSafe}"`), `Failed for ${name}. Header was: ${cd}`);
        // Assert filename*=UTF-8'' has original value URI-encoded
        const expectedEncoded = encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        assert.ok(cd.includes(`filename*=UTF-8''${expectedEncoded}`), `Failed for ${name}. Header was: ${cd}`);
        
        // Ensure no actual CR or LF in header
        assert.ok(!cd.includes('\r') && !cd.includes('\n'), `Header contains CR/LF for ${name}`);
      } finally {
        if (shutdownForTest) {
          await shutdownForTest();
        }
        path.basename = originalBasename;
        try {
          fs.unlinkSync(dummyPath);
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  });
});
