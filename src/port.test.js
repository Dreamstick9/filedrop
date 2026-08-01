/**
 * Tests for the port manager.
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { findAvailablePort, MAX_PORT, _resetFirewallWarning } = require('./port.js');

test('Port Manager', async (t) => {
  t.afterEach(() => {
    _resetFirewallWarning();
  });

  await t.test('Auto-selection success on first try', async () => {
    // Assuming 8000 is open, it should return 8000
    // Since we don't have the implementation yet, this will fail
    // if port.js doesn't exist, which is fine for missing implementation
    try {
      const port = await findAvailablePort(8000, 8999);
      assert.ok(port >= 8000 && port <= 8999);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        t.skip('port.js not implemented yet');
      } else {
        throw e;
      }
    }
  });

  await t.test('First port in use (fallback)', async () => {
    let server;
    try {
      server = net.createServer();
      await new Promise(r => server.listen(0, '0.0.0.0', r));
      let p = server.address().port;
      
      // If the ephemeral port is too close to MAX_PORT, fall back to a safe lower port
      if (p + 5 > MAX_PORT) {
        server.close();
        await new Promise(r => server.once('close', r));
        p = 50000;
        await new Promise(r => server.listen(p, '0.0.0.0', r));
      }
      
      const port = await findAvailablePort(p, p + 5);
      assert.ok(port > p && port <= p + 5);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        t.skip('port.js not implemented yet');
      } else {
        throw e;
      }
    } finally {
      if (server) {
        server.close();
      }
    }
  });

  await t.test('_resetFirewallWarning resets state between test runs', async () => {
    assert.strictEqual(typeof _resetFirewallWarning, 'function');
    _resetFirewallWarning();
    // Verify calling reset executes cleanly without throwing
    _resetFirewallWarning();
  });
});

test('Concurrent port probing', async (t) => {
  t.afterEach(() => {
    _resetFirewallWarning();
  });

  async function bindToPort(port) {
    const srv = net.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, '0.0.0.0', resolve);
    });
    return srv;
  }

  await t.test('Returns the lowest available port past a run of busy ports', async () => {
    const base = 30000 + Math.floor(Math.random() * 20000);
    const servers = [];
    try {
      // Occupy four consecutive ports; the fifth must be chosen.
      for (let i = 0; i < 4; i++) {
        servers.push(await bindToPort(base + i));
      }
      const port = await findAvailablePort(base, base + 9);
      assert.strictEqual(port, base + 4);
    } finally {
      await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
    }
  });

  await t.test('Throws ERR_PORT_EXHAUSTED when every candidate is busy', async () => {
    const base = 50000 + Math.floor(Math.random() * 10000);
    const servers = [];
    try {
      for (let i = 0; i < 20; i++) {
        try {
          servers.push(await bindToPort(base + i));
        } catch {
          // Port already taken by something else; skip it.
        }
      }
      await assert.rejects(() => findAvailablePort(base, base + 19), /ERR_PORT_EXHAUSTED/);
    } finally {
      await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
    }
  });
});
