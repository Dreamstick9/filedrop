const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const os = require('node:os');

const mdnsPath = require.resolve('./mdns.js');
const multicastDnsPath = require.resolve('multicast-dns');

function loadMdnsWithMock(factory) {
  const originalMulticastDns = require.cache[multicastDnsPath];

  delete require.cache[mdnsPath];
  require.cache[multicastDnsPath] = {
    id: multicastDnsPath,
    filename: multicastDnsPath,
    loaded: true,
    exports: factory
  };

  return {
    mdns: require('./mdns.js'),
    restore() {
      delete require.cache[mdnsPath];
      if (originalMulticastDns) {
        require.cache[multicastDnsPath] = originalMulticastDns;
      } else {
        delete require.cache[multicastDnsPath];
      }
    }
  };
}

test('mDNS query failures during probe are warned and cleaned up', async (t) => {
  let instance;
  const warnings = [];

  t.mock.method(console, 'warn', (message) => {
    warnings.push(message);
  });

  const { mdns, restore } = loadMdnsWithMock(() => {
    instance = new EventEmitter();
    instance.query = () => {
      throw new Error('socket closed');
    };
    instance.respond = (_packet, callback) => {
      callback();
    };
    instance.destroy = () => {};
    return instance;
  });

  t.after(restore);

  const result = await mdns.announce({
    filename: 'sample.txt',
    ip: '127.0.0.1',
    port: 4321,
    size: 12,
    transferId: 'test-transfer',
    mdnsName: 'sample-filedrop'
  });

  assert.deepStrictEqual(result, {
    name: 'sample-filedrop',
    mdnsAvailable: true
  });
  assert.strictEqual(instance.listenerCount('response'), 0);
  assert.ok(
    warnings.some((message) =>
      message.includes(
        '[filedrop:mDNS] probe query failed for "sample-filedrop._http._tcp.local": socket closed'
      )
    )
  );

  await mdns.deregister();
});

test('concurrent announce abandons the first call and keeps the final session', async (t) => {
  const instances = [];

  const { mdns, restore } = loadMdnsWithMock(() => {
    const instance = new EventEmitter();
    instance.query = () => {
      setTimeout(() => {
        instance.emit('response', { answers: [] });
      }, 20);
    };
    instance.respond = (_packet, callback) => {
      callback();
    };
    instance.destroy = () => {};
    instances.push(instance);
    return instance;
  });

  t.after(restore);

  const promise1 = mdns.announce({
    filename: 'sample.txt',
    ip: '127.0.0.1',
    port: 4321,
    size: 12,
    transferId: 'test-transfer-1',
    mdnsName: 'sample-filedrop'
  });

  const promise2 = mdns.announce({
    filename: 'sample.txt',
    ip: '127.0.0.1',
    port: 4322,
    size: 34,
    transferId: 'test-transfer-2',
    mdnsName: 'sample-filedrop-2'
  });

  const [result1, result2] = await Promise.all([promise1, promise2]);

  assert.deepStrictEqual(result1, {
    name: '',
    mdnsAvailable: false
  });
  assert.deepStrictEqual(result2, {
    name: 'sample-filedrop-2',
    mdnsAvailable: true
  });

  await mdns.deregister();

  assert.strictEqual(instances.length, 2);
  assert.strictEqual(instances[0].listenerCount('response'), 0);
  assert.strictEqual(instances[0].listenerCount('query'), 0);
  assert.strictEqual(instances[1].listenerCount('response'), 0);
  assert.strictEqual(instances[1].listenerCount('query'), 0);
});

test('Windows registration timeout respects a configurable config.mdnsTimeout', async (t) => {
  t.mock.method(os, 'platform', () => 'win32');

  const { mdns, restore } = loadMdnsWithMock(() => {
    const instance = new EventEmitter();
    // Never respond to the probe query, so the only way announce() settles
    // is via the Windows registration timeout.
    instance.query = () => {};
    instance.respond = (_packet, callback) => {
      callback();
    };
    instance.destroy = () => {};
    return instance;
  });

  t.after(restore);

  const start = Date.now();
  const result = await mdns.announce({
    filename: 'sample.txt',
    ip: '127.0.0.1',
    port: 4321,
    size: 12,
    transferId: 'test-transfer-timeout',
    mdnsName: 'sample-filedrop',
    mdnsTimeout: 50
  });
  const elapsed = Date.now() - start;

  assert.deepStrictEqual(result, {
    name: '',
    mdnsAvailable: false
  });
  // Should settle close to the configured 50ms timeout, not the 1000ms default.
  assert.ok(elapsed < 500, `expected announce() to settle well under 500ms, took ${elapsed}ms`);

  await mdns.deregister();
});
