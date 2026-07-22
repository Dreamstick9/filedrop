/**
 * src/security.test.js
 * Unit tests for security helper module (validateToken, createConnectionLimiter, isSensitiveFile, confirmSensitiveFile).
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const readline = require('node:readline');
const {
  validateToken,
  createConnectionLimiter,
  isSensitiveFile,
  confirmSensitiveFile
} = require('./security.js');

test('Security Helpers', async (t) => {
  await t.test('validateToken: allows request when no token is required', () => {
    assert.strictEqual(validateToken('http://localhost:8000/download', null), true);
    assert.strictEqual(validateToken('http://localhost:8000/download', ''), true);
  });

  await t.test('validateToken: returns true when URL query parameter t matches required token', () => {
    assert.strictEqual(validateToken('http://localhost:8000/download?t=secret123', 'secret123'), true);
  });

  await t.test('validateToken: returns false when URL query parameter t is missing or mismatched', () => {
    assert.strictEqual(validateToken('http://localhost:8000/download', 'secret123'), false);
    assert.strictEqual(validateToken('http://localhost:8000/download?t=wrong', 'secret123'), false);
    assert.strictEqual(validateToken('http://localhost:8000/download?t=short', 'secret123'), false);
  });

  await t.test('validateToken: returns false on invalid URL string', () => {
    assert.strictEqual(validateToken('not-a-valid-url-format', 'secret123'), false);
  });

  await t.test('createConnectionLimiter: limits concurrent connections and decrements on close', () => {
    const limiter = createConnectionLimiter(2);
    let rejectedCount = 0;
    const rejectCallback = () => { rejectedCount++; };

    const socket1 = new EventEmitter();
    const socket2 = new EventEmitter();
    const socket3 = new EventEmitter();

    assert.strictEqual(limiter.handleConnection(socket1, rejectCallback), true);
    assert.strictEqual(limiter.handleConnection(socket2, rejectCallback), true);

    // Threshold reached: 3rd connection must be rejected
    assert.strictEqual(limiter.handleConnection(socket3, rejectCallback), false);
    assert.strictEqual(rejectedCount, 1);

    // Socket 1 closes
    socket1.emit('close');

    // 4th connection should now be accepted
    const socket4 = new EventEmitter();
    assert.strictEqual(limiter.handleConnection(socket4, rejectCallback), true);
  });

  await t.test('isSensitiveFile: identifies sensitive file patterns correctly', () => {
    assert.strictEqual(isSensitiveFile('/path/to/server.pem'), true);
    assert.strictEqual(isSensitiveFile('/path/to/private.key'), true);
    assert.strictEqual(isSensitiveFile('/project/.env'), true);
    assert.strictEqual(isSensitiveFile('/project/.env.local'), true);
    assert.strictEqual(isSensitiveFile('/home/user/.ssh/id_rsa'), true);
    assert.strictEqual(isSensitiveFile('/path/to/credentials.json'), true);

    // Standard non-sensitive files
    assert.strictEqual(isSensitiveFile('/path/to/document.pdf'), false);
    assert.strictEqual(isSensitiveFile('/path/to/image.png'), false);
    assert.strictEqual(isSensitiveFile('/path/to/notes.txt'), false);
  });

  await t.test('confirmSensitiveFile: returns true immediately for non-sensitive file', async () => {
    const confirmed = await confirmSensitiveFile('/path/to/public-file.txt');
    assert.strictEqual(confirmed, true);
  });

  await t.test('confirmSensitiveFile: prompts user and returns true for "y" / "Y" input', async (tContext) => {
    const mockRl = {
      question: (prompt, callback) => {
        callback('y');
      },
      close: () => {}
    };

    tContext.mock.method(readline, 'createInterface', () => mockRl);

    const confirmedLower = await confirmSensitiveFile('/path/to/secret.pem');
    assert.strictEqual(confirmedLower, true);

    const mockRlUpper = {
      question: (prompt, callback) => {
        callback('Y');
      },
      close: () => {}
    };

    tContext.mock.method(readline, 'createInterface', () => mockRlUpper);

    const confirmedUpper = await confirmSensitiveFile('/path/to/secret.env');
    assert.strictEqual(confirmedUpper, true);
  });

  await t.test('confirmSensitiveFile: prompts user and returns false for "n" / non-y input', async (tContext) => {
    const mockRl = {
      question: (prompt, callback) => {
        callback('n');
      },
      close: () => {}
    };

    tContext.mock.method(readline, 'createInterface', () => mockRl);

    const confirmedNo = await confirmSensitiveFile('/path/to/id_rsa');
    assert.strictEqual(confirmedNo, false);
  });
});
