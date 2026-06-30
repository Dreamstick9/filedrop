const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');

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
