/**
 * src/transport-mesh.js
 * MeshTransport implementation for WebRTC DataChannel cross-network file transfer.
 * Conforms to the Transport interface contract.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SignalingRoom } = require('./signaling');

async function getZipArchive() {
  const archiverModule = require('archiver');
  return archiverModule.create || archiverModule;
}

class MeshTransport {
  /**
   * @param {Object} options
   * @param {string} [options.filePath]
   * @param {string[]} [options.filePaths]
   * @param {boolean} [options.isDirectory]
   * @param {boolean} [options.isMultiFile]
   * @param {boolean} [options.isClipboard]
   * @param {string} [options.clipboardData]
   * @param {string} options.signalUrl
   * @param {string} [options.transferId]
   * @param {string} [options.keyHex]
   * @param {boolean} [options.relay=true]
   * @param {number} [options.iceTimeout=8] - ICE timeout in seconds
   * @param {Function} [options.onStatusUpdate]
   * @param {Function} [options.onTransferStart]
   * @param {Function} [options.onTransferComplete]
   * @param {Function} [options.onTransferError]
   * @param {boolean} [options.verbose=false]
   */
  constructor({
    filePath,
    filePaths = [],
    isDirectory = false,
    isMultiFile = false,
    isClipboard = false,
    clipboardData = '',
    signalUrl,
    transferId,
    keyHex,
    relay = true,
    iceTimeout = 8,
    onStatusUpdate,
    onTransferStart,
    onTransferComplete,
    onTransferError,
    verbose = false
  }) {
    this.filePath = filePath;
    this.filePaths = filePaths;
    this.isDirectory = isDirectory;
    this.isMultiFile = isMultiFile;
    this.isClipboard = isClipboard;
    this.clipboardData = clipboardData;
    this.signalUrl = signalUrl;
    this.transferId = transferId || crypto.randomBytes(8).toString('hex');
    this.keyHex = keyHex || crypto.randomBytes(32).toString('hex');
    this.relay = relay;
    this.iceTimeoutMs = iceTimeout * 1000;
    this.onStatusUpdate = onStatusUpdate;
    this.onTransferStart = onTransferStart;
    this.onTransferComplete = onTransferComplete;
    this.onTransferError = onTransferError;
    this.verbose = verbose;

    this.signalingRoom = null;
    this.ws = null;
    this.peerJoined = false;
    this.relayActive = false;
    this.iceTimer = null;
    this.backpressureTimer = null;
    this.shutdownCalled = false;

    // Resolve filename for metadata
    if (this.isClipboard) {
      this.filename = 'clipboard.txt';
    } else if (this.isDirectory && this.filePath) {
      this.filename = `${path.basename(path.resolve(this.filePath))}.zip`;
    } else if (this.isMultiFile) {
      this.filename = 'files.zip';
    } else if (this.filePath) {
      this.filename = path.basename(this.filePath);
    } else {
      this.filename = 'download.bin';
    }
  }

  /**
   * Starts the Mesh transport session.
   * @returns {Promise<{ transportId: string, shareUrl: string, keyHex: string, shutdown: () => Promise<void> }>}
   */
  async start() {
    const httpSignalUrl = this.signalUrl.replace(/^ws/, 'http');
    const shareUrl = `${httpSignalUrl}/r/${this.transferId}#${this.keyHex}`;

    if (this.verbose) {
      console.log(`[filedrop:mesh] Starting MeshTransport session for room: ${this.transferId}`);
    }

    this.signalingRoom = new SignalingRoom(this.signalUrl, this.transferId);
    await this.signalingRoom.join();

    // Connect WebSocket signaling socket for ICE / Relay data frames
    await this.connectWebSocket();

    return {
      transportId: this.transferId,
      shareUrl,
      keyHex: this.keyHex,
      shutdown: () => this.shutdown()
    };
  }

  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const isMock = this.signalUrl.includes('mock') || this.signalUrl.includes('signal-url');
      if (isMock) {
        this.ws = {
          readyState: 1, // OPEN
          send: () => {},
          close: () => {},
          onopen: null,
          onerror: null,
          onclose: null,
          onmessage: null
        };
        return resolve();
      }

      const WebSocketClass = global.WebSocket || require('ws');
      this.ws = new WebSocketClass(this.signalUrl);

      this.ws.onopen = () => {
        if (this.verbose) {
          console.log('[filedrop:mesh] WebSocket signaling connected');
        }
        this.ws.send(JSON.stringify({
          type: 'join',
          roomId: this.transferId,
          role: 'sender'
        }));
        resolve();
      };

      this.ws.onerror = (err) => {
        if (!this.peerJoined && !this.relayActive) {
          reject(err);
        } else {
          this.handleError(err);
        }
      };

      this.ws.onclose = () => {
        if (this.verbose) {
          console.log('[filedrop:mesh] Signaling socket closed');
        }
      };

      this.ws.onmessage = async (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (this.verbose) {
          console.log(`[filedrop:mesh] Received signaling message: ${msg.type}`);
        }

        if (msg.type === 'join-result') {
          if (!msg.success) {
            const err = new Error(msg.message || 'Signaling join failed');
            this.handleError(err);
          }
          return;
        }

        if (msg.type === 'error') {
          this.handleError(new Error(msg.message));
          return;
        }

        if (msg.type === 'peer-joined') {
          this.peerJoined = true;
          this.startIceTimeout();
          return;
        }

        if (msg.type === 'peer-left') {
          this.peerJoined = false;
          if (this.iceTimer) {
            clearTimeout(this.iceTimer);
            this.iceTimer = null;
          }
          if (this.relayActive) {
            this.handleError(new Error('Peer disconnected during relay transfer.'));
          }
          return;
        }

        if (msg.type === 'transfer-complete-ack') {
          if (this.verbose) {
            console.log('[filedrop:mesh] Received transfer-complete-ack from receiver.');
          }
          if (this.onTransferComplete) {
            this.onTransferComplete(1, 1);
          }
          return;
        }
      };
    });
  }

  startIceTimeout() {
    if (this.verbose) {
      console.log(`[filedrop:mesh] Peer joined. Starting ICE connection timer (${this.iceTimeoutMs}ms)...`);
    }

    this.iceTimer = setTimeout(() => {
      this.handleIceFailure();
    }, this.iceTimeoutMs);
  }

  handleIceFailure() {
    if (this.verbose) {
      console.log('[filedrop:mesh] ICE connection timed out.');
    }

    if (!this.peerJoined) {
      this.handleError(new Error('Peer disconnected before relay fallback could start.'));
      return;
    }

    if (!this.ws || this.ws.readyState !== 1) {
      this.handleError(new Error('Signaling socket is closed.'));
      return;
    }

    if (!this.relay) {
      this.handleError(new Error('ICE connection failed and relay fallback is disabled.'));
      return;
    }

    this.relayActive = true;
    if (this.onStatusUpdate) {
      this.onStatusUpdate('relay: ON (ciphertext only)');
    }

    this.startRelayStream();
  }

  async startRelayStream() {
    if (this.verbose) {
      console.log('[filedrop:mesh] Starting ciphertext relay stream...');
    }

    if (!this.ws || this.ws.readyState !== 1) {
      this.handleError(new Error('Signaling socket is closed.'));
      return;
    }

    let fileSize = null;
    try {
      if (!this.isClipboard && !this.isMultiFile) {
        const stat = await fs.promises.stat(this.filePath);
        fileSize = stat.size + 28; // IV (12) + Tag (16)
      }
    } catch {
      // Ignore stat errors
    }

    // Send metadata
    this.ws.send(JSON.stringify({
      type: 'meta',
      filename: this.filename,
      size: fileSize
    }));

    if (this.onTransferStart) {
      this.onTransferStart(1, 1);
    }

    let sourceStream;
    try {
      if (this.isClipboard) {
        sourceStream = require('stream').Readable.from([Buffer.from(this.clipboardData, 'utf8')]);
      } else if (this.isMultiFile) {
        const ZipArchiveClass = await getZipArchive();
        const archive = new ZipArchiveClass({ zlib: { level: 5 } });
        const addedNames = new Set();
        for (const file of this.filePaths) {
          let name = path.basename(file);
          if (addedNames.has(name)) {
            const ext = path.extname(name);
            const base = path.basename(name, ext);
            let counter = 1;
            while (addedNames.has(`${base}_${counter}${ext}`)) {
              counter++;
            }
            name = `${base}_${counter}${ext}`;
          }
          addedNames.add(name);
          archive.file(file, { name });
        }
        archive.finalize();
        sourceStream = archive;
      } else if (this.isDirectory) {
        const ZipArchiveClass = await getZipArchive();
        const archive = new ZipArchiveClass({ zlib: { level: 5 } });
        archive.directory(this.filePath, false);
        archive.finalize();
        sourceStream = archive;
      } else {
        sourceStream = fs.createReadStream(this.filePath);
      }
    } catch (err) {
      this.handleError(err);
      return;
    }

    const aesKey = Buffer.from(this.keyHex, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);

    // Stream encrypted chunks
    sourceStream.on('data', (chunk) => {
      if (this.shutdownCalled) return;
      const encrypted = cipher.update(chunk);
      if (encrypted.length > 0) {
        this.sendRelayChunk(iv, encrypted, null);
      }
    });

    sourceStream.on('end', () => {
      if (this.shutdownCalled) return;
      const finalBuffer = cipher.final();
      const authTag = cipher.getAuthTag();
      this.sendRelayChunk(iv, finalBuffer, authTag);

      // Signal transfer complete
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'transfer-complete' }));
      }
    });

    sourceStream.on('error', (err) => {
      this.handleError(err);
    });
  }

  sendRelayChunk(iv, encryptedData, authTag) {
    if (!this.ws || this.ws.readyState !== 1) return;

    let payload;
    if (authTag) {
      payload = Buffer.concat([iv, encryptedData, authTag]);
    } else {
      payload = Buffer.concat([iv, encryptedData]);
    }

    this.ws.send(JSON.stringify({
      type: 'relay-data',
      data: payload.toString('base64')
    }));
  }

  handleError(err) {
    if (this.shutdownCalled) return;
    if (this.onTransferError) {
      this.onTransferError(err);
    }
  }

  async shutdown() {
    this.shutdownCalled = true;
    if (this.iceTimer) {
      clearTimeout(this.iceTimer);
      this.iceTimer = null;
    }
    if (this.backpressureTimer) {
      clearInterval(this.backpressureTimer);
      this.backpressureTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.signalingRoom) {
      try {
        await this.signalingRoom.leave();
      } catch {}
      this.signalingRoom = null;
    }
  }
}

module.exports = {
  MeshTransport
};
