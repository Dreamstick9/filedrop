/**
 * src/transport-mesh.js
 * Handles WebRTC mesh connection simulation and fallback to WebSocket relay.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let ZipArchive = null;
async function getZipArchive() {
  if (!ZipArchive) {
    const mod = await import('archiver');
    ZipArchive = mod.ZipArchive;
  }
  return ZipArchive;
}

class MeshTransport {
  constructor({
    filePath,
    filePaths = [],
    isMultiFile = false,
    isDirectory = false,
    isClipboard = false,
    clipboardData = null,
    signalUrl,
    transferId,
    keyHex,
    relay = true,
    relayPassword = null,
    iceTimeout = 8,
    onStatusUpdate,
    onTransferStart,
    onTransferComplete,
    onTransferError,
    verbose = false
  }) {
    this.filePath = filePath;
    this.filePaths = filePaths;
    this.isMultiFile = isMultiFile;
    this.isDirectory = isDirectory;
    this.isClipboard = isClipboard;
    this.clipboardData = clipboardData;
    this.signalUrl = signalUrl;
    this.transferId = transferId;
    this.keyHex = keyHex;
    this.relay = relay;
    this.relayPassword = relayPassword;
    this.iceTimeoutMs = iceTimeout * 1000;
    this.onStatusUpdate = onStatusUpdate;
    this.onTransferStart = onTransferStart;
    this.onTransferComplete = onTransferComplete;
    this.onTransferError = onTransferError;
    this.verbose = verbose;

    this.ws = null;
    this.iceTimer = null;
    this.relayActive = false;
    this.peerJoined = false;

    // Resolve filename
    if (this.isClipboard) {
      this.filename = 'clipboard.txt';
    } else if (this.isMultiFile) {
      this.filename = 'filedrop-bundle.zip';
    } else if (this.isDirectory) {
      this.filename = path.basename(this.filePath) + '.zip';
    } else {
      this.filename = path.basename(this.filePath);
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.verbose) {
        console.log(`[filedrop:mesh] Connecting to signaling server: ${this.signalUrl}`);
      }

      try {
        this.ws = new WebSocket(this.signalUrl);
      } catch (err) {
        this.handleError(err);
        return reject(err);
      }

      this.ws.onopen = () => {
        if (this.verbose) {
          console.log(`[filedrop:mesh] Connected. Joining room ${this.transferId} as sender`);
        }
        this.ws.send(JSON.stringify({
          type: 'join',
          roomId: this.transferId,
          role: 'sender',
          password: this.relayPassword
        }));
      };

      this.ws.onerror = (err) => {
        this.handleError(err);
        reject(err);
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
          if (msg.success) {
            resolve();
          } else {
            const err = new Error(msg.message || 'Signaling join failed');
            this.handleError(err);
            reject(err);
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

    let fileSize = null;
    try {
      if (!this.isClipboard && !this.isMultiFile) {
        const stat = await fs.promises.stat(this.filePath);
        fileSize = stat.size + 28; // plaintext size + GCM overhead (12 IV + 16 TAG)
      }
    } catch {
      // ignore stat errors
    }

    // Send meta first
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
        archive.directory(this.filePath, path.basename(this.filePath));
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

    // Send IV first
    this.ws.send(JSON.stringify({
      type: 'relay-data',
      data: iv.toString('base64')
    }));

    sourceStream.on('data', (chunk) => {
      const encrypted = cipher.update(chunk);
      if (encrypted.length > 0) {
        this.ws.send(JSON.stringify({
          type: 'relay-data',
          data: encrypted.toString('base64')
        }));

        // Backpressure check
        if (typeof this.ws.bufferedAmount === 'number' && this.ws.bufferedAmount > 1024 * 1024) {
          sourceStream.pause();
          this.backpressureTimer = setInterval(() => {
            if (!this.ws || typeof this.ws.bufferedAmount !== 'number' || this.ws.bufferedAmount === 0) {
              if (this.backpressureTimer) {
                clearInterval(this.backpressureTimer);
                this.backpressureTimer = null;
              }
              sourceStream.resume();
            }
          }, 50);
        }
      }
    });

    sourceStream.on('error', (err) => {
      this.handleError(err);
    });

    sourceStream.on('end', () => {
      const finalBuffer = cipher.final();
      if (finalBuffer.length > 0) {
        this.ws.send(JSON.stringify({
          type: 'relay-data',
          data: finalBuffer.toString('base64')
        }));
      }
      const authTag = cipher.getAuthTag();
      this.ws.send(JSON.stringify({
        type: 'relay-data',
        data: authTag.toString('base64')
      }));

      // Notify receiver transfer complete
      this.ws.send(JSON.stringify({
        type: 'transfer-complete'
      }));

      if (this.verbose) {
        console.log('[filedrop:mesh] Relay transfer complete stream sent. Waiting for ack...');
      }
    });
  }

  handleError(err) {
    if (this.iceTimer) {
      clearTimeout(this.iceTimer);
      this.iceTimer = null;
    }
    if (this.backpressureTimer) {
      clearInterval(this.backpressureTimer);
      this.backpressureTimer = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    if (this.onTransferError) {
      this.onTransferError(err);
    }
  }

  async shutdown() {
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
  }
}

module.exports = { MeshTransport };
