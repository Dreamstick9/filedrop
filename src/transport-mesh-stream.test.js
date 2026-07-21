/**
 * src/transport-mesh-stream.test.js
 * Unit and integration tests for MeshStreamSender, MeshStreamReceiver, chunker, and backpressure.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable } = require('stream');
const {
  CHUNK_SIZE,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  chunkBuffer,
  MeshStreamSender,
  MeshStreamReceiver
} = require('./transport-mesh-stream.js');

test('Chunker: Splits a 1 MiB buffer into N+1 16 KiB chunks and concatenation equals input', () => {
  const size = 1024 * 1024 + 500; // 1 MiB + 500 bytes
  const inputBuffer = crypto.randomBytes(size);

  const chunks = chunkBuffer(inputBuffer, CHUNK_SIZE);

  assert.ok(chunks.length > 1, 'Should create multiple chunks');
  for (let i = 0; i < chunks.length - 1; i++) {
    assert.strictEqual(chunks[i].length, CHUNK_SIZE, `Chunk ${i} must be exactly ${CHUNK_SIZE} bytes`);
  }

  const lastChunk = chunks[chunks.length - 1];
  assert.ok(lastChunk.length <= CHUNK_SIZE, 'Last chunk must be <= CHUNK_SIZE');
  assert.strictEqual(lastChunk.length, 500, 'Last chunk length must match remainder');

  const reassembled = Buffer.concat(chunks);
  assert.deepStrictEqual(reassembled, inputBuffer, 'Reassembled buffer must match input buffer exactly');
});

test('MeshStream Round-Trip Integration: Encrypts, streams, reassembles and decrypts byte-identically', async () => {
  const key = crypto.randomBytes(32);
  const originalPayload = crypto.randomBytes(512 * 1024); // 512 KiB random data
  const sourceStream = Readable.from([originalPayload]);

  const receivedChunks = [];
  const mockDataChannel = {
    bufferedAmount: 0,
    send(chunk) {
      receivedChunks.push(Buffer.from(chunk));
    }
  };

  const sender = new MeshStreamSender({
    sourceStream,
    aesKey: key,
    dataChannel: mockDataChannel
  });

  const receiver = new MeshStreamReceiver({ aesKey: key });

  await sender.start();

  // Pass all sent chunks through receiver reassembly machine
  for (const chunk of receivedChunks) {
    receiver.handleChunk(chunk);
  }

  const decrypted = receiver.finalize();
  assert.deepStrictEqual(decrypted, originalPayload, 'Decrypted output must match original input byte-identically');
});

test('MeshStream Backpressure: Pauses source when bufferedAmount >= 1 MiB and resumes when <= 256 KiB', async () => {
  const key = crypto.randomBytes(32);
  // Create 3 MiB of data
  const payloadSize = 3 * 1024 * 1024;
  const inputData = crypto.randomBytes(payloadSize);
  const sourceStream = Readable.from([inputData]);

  let peakBufferedAmount = 0;
  let pauseTriggered = false;
  let resumeTriggered = false;

  const mockDataChannel = {
    _bufferedAmount: 0,

    get bufferedAmount() {
      return this._bufferedAmount;
    },

    send(chunk) {
      this._bufferedAmount += chunk.length;
      if (this._bufferedAmount > peakBufferedAmount) {
        peakBufferedAmount = this._bufferedAmount;
      }
    }
  };

  const sender = new MeshStreamSender({
    sourceStream,
    aesKey: key,
    dataChannel: mockDataChannel,
    highWatermark: HIGH_WATERMARK,
    lowWatermark: LOW_WATERMARK
  });

  // Drain simulated buffer periodically
  const drainInterval = setInterval(() => {
    if (mockDataChannel._bufferedAmount > 0) {
      // Drain 128 KiB per tick
      mockDataChannel._bufferedAmount = Math.max(0, mockDataChannel._bufferedAmount - 128 * 1024);
    }
  }, 10);

  sourceStream.on('pause', () => {
    pauseTriggered = true;
  });

  sourceStream.on('resume', () => {
    resumeTriggered = true;
  });

  await sender.start();
  clearInterval(drainInterval);

  assert.ok(pauseTriggered, 'Source stream should be paused when high watermark is hit');
  assert.ok(resumeTriggered, 'Source stream should resume when low watermark is hit');
  assert.ok(peakBufferedAmount >= HIGH_WATERMARK, 'Buffered amount should reach or exceed high watermark threshold');
});

test('MeshStreamReceiver: Abrupt mid-stream teardown emits transfer error', async () => {
  const key = crypto.randomBytes(32);
  const receiver = new MeshStreamReceiver({ aesKey: key });

  const iv = crypto.randomBytes(12);
  receiver.handleChunk(iv); // Record IV

  // Send partial ciphertext chunk
  receiver.handleChunk(Buffer.from('partial ciphertext content'));

  let errorEmitted = false;
  let errorMessage = null;

  receiver.on('error', (err) => {
    errorEmitted = true;
    errorMessage = err.message;
  });

  // Destroy receiver mid-stream
  receiver.destroy();

  assert.ok(errorEmitted, 'Error event should be emitted on destroy');
  assert.strictEqual(errorMessage, 'Transfer aborted mid-stream');

  assert.throws(() => {
    receiver.finalize();
  }, /Receiver is destroyed/);
});
