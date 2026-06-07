const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const { getInterface } = require('./network.js');

test('Network Interface Discovery', async (t) => {
    const originalNetworkInterfaces = os.networkInterfaces;
    const originalExit = process.exit;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;

    t.afterEach(() => {
        os.networkInterfaces = originalNetworkInterfaces;
        process.exit = originalExit;
        console.error = originalError;
        console.warn = originalWarn;
        console.log = originalLog;
    });

    await t.test('Machine with only loopback', (t) => {
        os.networkInterfaces = () => ({
            lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
        });
        process.exit = (code) => { throw new Error(`exit_${code}`); };
        console.error = () => {};
        
        assert.throws(() => {
            getInterface();
        }, /exit_2/);
    });

    await t.test('Machine with Wi-Fi + Docker bridge', (t) => {
        os.networkInterfaces = () => ({
            lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
            en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
            docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }]
        });
        
        const result = getInterface();
        assert.strictEqual(result.name, 'en0');
        assert.strictEqual(result.info.address, '192.168.1.10');
    });

    await t.test('Machine with VPN + Ethernet', (t) => {
        os.networkInterfaces = () => ({
            eth0: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
            utun0: [{ address: '10.8.0.2', family: 'IPv4', internal: false }]
        });
        
        const result = getInterface();
        assert.strictEqual(result.name, 'eth0');
        assert.strictEqual(result.info.address, '10.0.0.5');
    });

    await t.test('Machine on Windows with Wi-Fi', (t) => {
        os.networkInterfaces = () => ({
            'Wi-Fi': [{ address: '192.168.0.50', family: 'IPv4', internal: false }],
            'Ethernet 2': [{ address: '169.254.10.10', family: 'IPv4', internal: false }]
        });
        
        const result = getInterface();
        assert.strictEqual(result.name, 'Wi-Fi');
        assert.strictEqual(result.info.address, '192.168.0.50');
    });

    await t.test('--bind override with valid IP', (t) => {
        os.networkInterfaces = () => ({
            en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
            en1: [{ address: '10.10.0.5', family: 'IPv4', internal: false }]
        });
        
        const result = getInterface({ bind: '10.10.0.5' });
        assert.strictEqual(result.name, 'en1');
        assert.strictEqual(result.info.address, '10.10.0.5');
    });

    await t.test('--bind override with invalid IP', (t) => {
        os.networkInterfaces = () => ({
            en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }]
        });
        process.exit = (code) => { throw new Error(`exit_${code}`); };
        console.error = () => {};
        
        assert.throws(() => {
            getInterface({ bind: '999.999.999.999' });
        }, /exit_1/);
        
        assert.throws(() => {
            getInterface({ bind: '127.0.0.1' });
        }, /exit_1/);
        
        assert.throws(() => {
            getInterface({ bind: '192.168.1.11' }); // Non-existent
        }, /exit_1/);
    });

    await t.test('Subnet Validation Warning', (t) => {
        os.networkInterfaces = () => ({
            en0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }]
        });
        let warned = false;
        console.warn = () => { warned = true; };
        console.error = () => {};
        
        getInterface();
        assert.strictEqual(warned, true);
    });
});
