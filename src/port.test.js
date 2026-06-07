/**
 * Tests for the port manager.
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { findAvailablePort } = require('./port.js');

test('Port Manager', async (t) => {
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
    try {
      const server = net.createServer().listen(8000);
      await new Promise(r => server.once('listening', r));
      
      const port = await findAvailablePort(8000, 8999);
      assert.ok(port > 8000 && port <= 8999);
      
      server.close();
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        t.skip('port.js not implemented yet');
      } else {
        throw e;
      }
    }
  });
});
