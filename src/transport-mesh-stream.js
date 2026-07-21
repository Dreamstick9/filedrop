/**
 * src/transport-mesh-stream.js
 * Stream primitives for WebRTC RTCDataChannel encrypted file transfers.
 * Implements 16 KiB chunking, high/low watermark backpressure, and receiver reassembly.
 */
const crypto = require('crypto');
const EventEmitter = require('events');

const CHUNK_SIZE = 16 * 1024; // 16 KiB
const HIGH_WATERMARK = 1024 * 1024; // 1 MiB
const LOW_WATERMARK = 256 * 1024; // 256 KiB

/**
 * Splits a Buffer or Uint8Array into an array of chunks of size <= chunkSize.
 * 
 * @param {Buffer|Uint8Array} buffer 
 * @param {number} [chunkSize=16384] 
 * @returns {Buffer[]}
 */
function chunkBuffer(buffer, chunkSize = CHUNK_SIZE) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const chunks = [];
  let offset = 0;
  while (offset < buf.length) {
    const end = Math.min(offset + chunkSize, buf.length);
    chunks.push(buf.subarray(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * MeshStreamSender
 * Encrypts a source stream using AES-256-GCM and streams 16 KiB chunks over RTCDataChannel.
 * Controls flow with manual high (1 MiB) and low (256 KiB) watermark backpressure.
 */
class MeshStreamSender extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('stream').Readable} options.sourceStream
   * @param {Buffer|string} options.aesKey - 32-byte key or hex string
   * @param {RTCDataChannel|Object} options.dataChannel
   * @param {number} [options.chunkSize]
   * @param {number} [options.highWatermark]
   * @param {number} [options.lowWatermark]
   * @param {boolean} [options.verbose]
   */
  constructor({
    sourceStream,
    aesKey,
    dataChannel,
    chunkSize = CHUNK_SIZE,
    highWatermark = HIGH_WATERMARK,
    lowWatermark = LOW_WATERMARK,
    verbose = false
  }) {
    super();
    this.sourceStream = sourceStream;
    this.key = typeof aesKey === 'string' ? Buffer.from(aesKey, 'hex') : aesKey;
    this.dataChannel = dataChannel;
    this.chunkSize = chunkSize;
    this.highWatermark = highWatermark;
    this.lowWatermark = lowWatermark;
    this.verbose = verbose;

    this.paused = false;
    this.destroyed = false;
    this.backpressureTimer = null;
    this.pendingBuffer = Buffer.alloc(0);

    // Generate random 12-byte IV for AES-256-GCM
    this.iv = crypto.randomBytes(12);
    this.cipher = crypto.createCipheriv('aes-256-gcm', this.key, this.iv);
  }

  /**
   * Starts sending the encrypted stream.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        return reject(new Error('Sender already destroyed'));
      }

      // Send IV (12 bytes) first
      try {
        this.sendChunk(this.iv);
      } catch (err) {
        return reject(err);
      }

      // Set up backpressure monitoring
      if (this.dataChannel && 'bufferedAmountLowThreshold' in this.dataChannel) {
        try {
          this.dataChannel.bufferedAmountLowThreshold = this.lowWatermark;
          this.dataChannel.onbufferedamountlow = () => this.checkBackpressure();
        } catch {
          // Ignore unsupported property
        }
      }

      // Fallback polling for browser/mock backpressure compatibility
      this.backpressureTimer = setInterval(() => {
        this.checkBackpressure();
      }, 20);

      this.sourceStream.on('data', (chunk) => {
        if (this.destroyed) return;
        const encrypted = this.cipher.update(chunk);
        if (encrypted.length > 0) {
          this.enqueueAndSend(encrypted);
        }
        this.checkBackpressure();
      });

      this.sourceStream.on('end', () => {
        if (this.destroyed) return;
        try {
          const finalEncrypted = this.cipher.final();
          if (finalEncrypted.length > 0) {
            this.enqueueAndSend(finalEncrypted);
          }
          // Flush remaining pending buffer
          this.flushPendingBuffer(true);

          // Send auth tag (16 bytes) last
          const authTag = this.cipher.getAuthTag();
          this.sendChunk(authTag);

          this.cleanup();
          this.emit('complete');
          resolve();
        } catch (err) {
          this.destroy(err);
          reject(err);
        }
      });

      this.sourceStream.on('error', (err) => {
        this.destroy(err);
        reject(err);
      });
    });
  }

  /**
   * Enqueues data and transmits 16 KiB chunks.
   * @param {Buffer} data 
   */
  enqueueAndSend(data) {
    this.pendingBuffer = Buffer.concat([this.pendingBuffer, data]);
    this.flushPendingBuffer(false);
  }

  /**
   * Flushes chunks of size <= chunkSize from the pending buffer.
   * @param {boolean} forceAll 
   */
  flushPendingBuffer(forceAll = false) {
    while (this.pendingBuffer.length >= this.chunkSize || (forceAll && this.pendingBuffer.length > 0)) {
      const size = Math.min(this.chunkSize, this.pendingBuffer.length);
      const chunk = this.pendingBuffer.subarray(0, size);
      this.pendingBuffer = this.pendingBuffer.subarray(size);
      this.sendChunk(chunk);
    }
  }

  /**
   * Sends a single chunk over dataChannel while handling backpressure.
   * @param {Buffer} chunk 
   */
  sendChunk(chunk) {
    if (!this.dataChannel) return;
    this.dataChannel.send(chunk);
  }

  /**
   * Checks current dataChannel.bufferedAmount and pauses/resumes reading.
   */
  checkBackpressure() {
    if (!this.dataChannel) return;
    const buffered = this.dataChannel.bufferedAmount || 0;

    if (buffered >= this.highWatermark && !this.paused) {
      this.paused = true;
      if (this.verbose) {
        console.log(`[filedrop:stream] Backpressure HIGH watermark reached (${buffered} bytes). Pausing stream.`);
      }
      this.sourceStream.pause();
    } else if (buffered <= this.lowWatermark && this.paused) {
      this.paused = false;
      if (this.verbose) {
        console.log(`[filedrop:stream] Backpressure LOW watermark reached (${buffered} bytes). Resuming stream.`);
      }
      this.sourceStream.resume();
    }
  }

  /**
   * Cleans up timers and stream listeners.
   */
  cleanup() {
    if (this.backpressureTimer) {
      clearInterval(this.backpressureTimer);
      this.backpressureTimer = null;
    }
  }

  /**
   * Destroys the sender and aborts transfer.
   * @param {Error} [err] 
   */
  destroy(err) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanup();
    if (this.sourceStream && typeof this.sourceStream.destroy === 'function') {
      this.sourceStream.destroy();
    }
    if (err) {
      this.emit('error', err);
    }
  }
}

/**
 * MeshStreamReceiver
 * Three-state reassembly machine for incoming WebRTC RTCDataChannel binary messages.
 * States:
 *   1 = WAITING_IV (records 12-byte IV)
 *   2 = STREAMING (accumulates ciphertext)
 *   3 = FINALIZING (verifies 16-byte authTag and emits decrypted payload)
 */
class MeshStreamReceiver extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Buffer|string} options.aesKey
   * @param {boolean} [options.verbose]
   */
  constructor({ aesKey, verbose = false } = {}) {
    super();
    this.key = typeof aesKey === 'string' ? Buffer.from(aesKey, 'hex') : aesKey;
    this.verbose = verbose;

    this.state = 1; // 1: WAITING_IV, 2: STREAMING, 3: FINALIZING
    this.iv = null;
    this.chunks = [];
    this.totalBytes = 0;
    this.completed = false;
    this.destroyed = false;
  }

  /**
   * Process an incoming ArrayBuffer or Buffer chunk from RTCDataChannel.
   * @param {ArrayBuffer|Buffer|Uint8Array} data 
   */
  handleChunk(data) {
    if (this.destroyed || this.completed) return;

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (this.state === 1) { // WAITING_IV
      if (buf.length < 12) {
        this.destroy(new Error('Invalid initial payload: IV must be at least 12 bytes'));
        return;
      }
      this.iv = buf.subarray(0, 12);
      const remaining = buf.subarray(12);
      this.state = 2; // STREAMING

      if (remaining.length > 0) {
        this.chunks.push(remaining);
        this.totalBytes += remaining.length;
      }
      this.emit('start', { iv: this.iv });
      return;
    }

    if (this.state === 2) { // STREAMING
      this.chunks.push(buf);
      this.totalBytes += buf.length;
      this.emit('progress', { receivedBytes: this.totalBytes });
    }
  }

  /**
   * Signals end of transmission and decrypts the accumulated payload.
   * Last 16 bytes are extracted as GCM authTag.
   * @returns {Buffer} Decrypted payload
   */
  finalize() {
    if (this.destroyed) {
      throw new Error('Receiver is destroyed');
    }
    if (this.state !== 2) {
      throw new Error('Receiver cannot finalize: IV not received');
    }

    this.state = 3; // FINALIZING
    const fullEncrypted = Buffer.concat(this.chunks);

    if (fullEncrypted.length < 16) {
      const err = new Error('Payload too short: Missing 16-byte authentication tag');
      this.destroy(err);
      throw err;
    }

    const ciphertext = fullEncrypted.subarray(0, fullEncrypted.length - 16);
    const authTag = fullEncrypted.subarray(fullEncrypted.length - 16);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, this.iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      this.completed = true;
      this.emit('complete', decrypted);
      return decrypted;
    } catch (err) {
      const decryptErr = new Error(`Decryption failed: ${err.message}`);
      this.destroy(decryptErr);
      throw decryptErr;
    }
  }

  /**
   * Aborts reassembly and emits transfer error.
   * @param {Error} [err] 
   */
  destroy(err) {
    if (this.destroyed) return;
    this.destroyed = true;
    const error = err || new Error('Transfer aborted mid-stream');
    this.emit('error', error);
  }
}

module.exports = {
  CHUNK_SIZE,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  chunkBuffer,
  MeshStreamSender,
  MeshStreamReceiver
};
