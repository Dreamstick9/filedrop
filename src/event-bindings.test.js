const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');

const network = require('./network');
const port = require('./port');
const mdns = require('./mdns');
const server = require('./server');

test('Event Bindings', async (t) => {
  // Test network binding
  await t.test('network.bind listens to discover and resolves', async () => {
    const lifecycle = new EventEmitter();
    
    // Save original
    const originalGetInterface = network.getInterface;
    
    // Mock getInterface
    network.getInterface = async (options) => {
      assert.deepStrictEqual(options, { bind: '192.168.1.5', verbose: true });
      return { info: { address: '192.168.1.5' } };
    };

    network.bind(lifecycle);

    const promise = new Promise((resolve) => {
      lifecycle.once('network:resolved', (iface) => {
        assert.strictEqual(iface.info.address, '192.168.1.5');
        resolve();
      });
    });

    lifecycle.emit('network:discover', { bind: '192.168.1.5', verbose: true });
    await promise;

    // Restore original
    network.getInterface = originalGetInterface;
  });

  // Test port binding
  await t.test('port.bind listens to resolve and resolves', async () => {
    const lifecycle = new EventEmitter();
    
    const originalFindAvailablePort = port.findAvailablePort;
    port.findAvailablePort = async (start, end) => {
      assert.strictEqual(start, 8000);
      assert.strictEqual(end, 8999);
      return 8500;
    };

    port.bind(lifecycle);

    const promise = new Promise((resolve) => {
      lifecycle.once('port:resolved', (resolvedPort) => {
        assert.strictEqual(resolvedPort, 8500);
        resolve();
      });
    });

    lifecycle.emit('port:resolve', { startPort: 8000, endPort: 8999 });
    await promise;

    port.findAvailablePort = originalFindAvailablePort;
  });

  // Test mdns binding
  await t.test('mdns.bind listens to announce and announce-complete', async () => {
    const lifecycle = new EventEmitter();
    
    const originalAnnounce = mdns.announce;
    mdns.announce = async (config) => {
      assert.strictEqual(config.filename, 'test.txt');
      return { name: 'test-filedrop', mdnsAvailable: true };
    };

    mdns.bind(lifecycle);

    const promise = new Promise((resolve) => {
      lifecycle.once('mdns:announced', (result) => {
        assert.deepStrictEqual(result, { name: 'test-filedrop', mdnsAvailable: true });
        resolve();
      });
    });

    lifecycle.emit('mdns:announce', { filename: 'test.txt' });
    await promise;

    mdns.announce = originalAnnounce;
  });

  await t.test('server shutdown errors via lifecycle event are not silently swallowed', async () => {
    const lifecycle = new EventEmitter();
    const cleanups = [];

    const originalBind = server.bind;
    server.bind = (lifecycle) => {
      lifecycle.on('shutdown', (cleanups) => {
        cleanups.push(Promise.reject(new Error('server shutdown failed')));
      });
    };

    server.bind(lifecycle);

    lifecycle.emit('shutdown', cleanups);
    assert.strictEqual(cleanups.length, 1);

    let caughtError;
    try {
      await cleanups[0];
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'server shutdown error should propagate for lifecycle to handle');
    assert.strictEqual(caughtError.message, 'server shutdown failed');

    server.bind = originalBind;
  });

  // Test server binding and transfer mappings
  await t.test('server.bind mapping of transfer events', async () => {
    const lifecycle = new EventEmitter();
    
    const originalCreateServer = server.createServer;
    let registeredOnTransferStart;
    
    server.createServer = async (params) => {
      registeredOnTransferStart = params.onTransferStart;
      return {
        shutdown: async () => {},
        keyHex: 'abcdef',
        downloadPath: '/download'
      };
    };

    server.bind(lifecycle);

    const startPromise = new Promise((resolve) => {
      lifecycle.once('server:started', (data) => {
        assert.strictEqual(data.keyHex, 'abcdef');
        resolve();
      });
    });

    lifecycle.emit('server:start', { filePath: 'foo.txt' });
    await startPromise;

    // Check mapping of onTransferStart
    assert.ok(typeof registeredOnTransferStart === 'function');
    const transferStartPromise = new Promise((resolve) => {
      lifecycle.once('server:transfer-start', (data) => {
        assert.deepStrictEqual(data, { currentCount: 1, limit: 2 });
        resolve();
      });
    });

    registeredOnTransferStart(1, 2);
    await transferStartPromise;

    server.createServer = originalCreateServer;
  });
});
