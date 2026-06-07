/**
 * Tests for the QR code rendering module.
 */
const test = require('node:test');
const assert = require('node:assert');
const { renderQR, renderMetadataBox } = require('./qr.js');
const platform = require('./platform.js');

// Mock supportsColor by overriding platform for tests if needed, but since platform is required by qr.js
// We can mock process.stdout.isTTY and platforms.

test('QR Code Generation', async (t) => {
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  const originalSupportsAnsi = platform.supportsAnsi;
  const originalWarn = console.warn;

  t.afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
    process.stdout.columns = originalColumns;
    platform.supportsAnsi = originalSupportsAnsi;
    console.warn = originalWarn;
  });

  await t.test('QR output is a non-empty string', () => {
    process.stdout.isTTY = true;
    process.stdout.columns = 80;
    const output = renderQR('http://192.168.1.1:8080/');
    assert.ok(typeof output === 'string');
    assert.ok(output.length > 0);
  });

  await t.test('QR output contains ANSI codes in normal mode', () => {
    process.stdout.isTTY = true;
    process.stdout.columns = 80;
    platform.supportsAnsi = () => true;
    const output = renderQR('http://192.168.1.1:8080/');
    assert.ok(output.includes('\\x1b[') || output.includes('\x1b['), 'Should contain ANSI escape codes');
  });

  await t.test('QR output contains no ANSI codes in NO_COLOR mode', () => {
    process.stdout.isTTY = true;
    process.stdout.columns = 80;
    platform.supportsAnsi = () => false;
    const output = renderQR('http://192.168.1.1:8080/');
    assert.strictEqual(output.includes('\x1b['), false, 'Should not contain ANSI escape codes');
    assert.ok(output.includes('##') || output.includes('  '), 'Should contain ASCII blocks');
  });

  await t.test('Compact mode output is shorter than normal mode', () => {
    process.stdout.isTTY = true;
    process.stdout.columns = 80;
    platform.supportsAnsi = () => false;
    const normalOutput = renderQR('http://example.com');
    const compactOutput = renderQR('http://example.com', { compact: true });
    assert.ok(compactOutput.length < normalOutput.length);
  });

  await t.test('URL-only mode contains no block characters', () => {
    process.stdout.isTTY = true;
    const output = renderQR('http://example.com', { noQr: true });
    assert.ok(output.includes('http://example.com'));
    assert.strictEqual(output.includes('##'), false);
    assert.strictEqual(output.includes('\x1b['), false);
  });

  await t.test('Handles URLs of different lengths', () => {
    process.stdout.isTTY = true;
    platform.supportsAnsi = () => true;
    const shortUrl = renderQR('http://a.com');
    const longUrl = renderQR('http://192.168.1.123:8080/super-long-filename-that-will-increase-qr-size.pdf');
    assert.ok(shortUrl.length > 0);
    assert.ok(longUrl.length > 0);
    assert.ok(longUrl.length > shortUrl.length);
  });
});
