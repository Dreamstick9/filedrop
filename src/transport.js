/**
 * src/transport.js
 * Transport interface abstraction and transport selection policy.
 */
const server = require('./server');

/**
 * LanTransport wraps the local HTTP-based transfer server.
 */
class LanTransport {
  constructor() {
    this.name = 'lan';
    this.listeners = new Map();
  }

  /**
   * Subscribes to transport events ('transfer-start' | 'transfer-complete' | 'transfer-error').
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Emits an event to registered subscribers.
   * @param {string} event
   * @param {...any} args
   */
  emit(event, ...args) {
    const handlers = this.listeners.get(event) || [];
    for (const fn of handlers) {
      fn(...args);
    }
  }

  /**
   * Starts the LAN transfer server.
   * @param {Object} params
   * @param {string} [params.filePath]
   * @param {Array<string>} [params.filePaths]
   * @param {boolean} [params.isMultiFile]
   * @param {boolean} [params.isDirectory]
   * @param {boolean} [params.isClipboard]
   * @param {string} [params.clipboardData]
   * @param {number} params.port
   * @param {string} [params.bindIp]
   * @param {number} [params.downloadLimit]
   * @param {string} [params.ip]
   * @param {string} [params.token]
   * @param {Object} [params.options]
   * @returns {Promise<{ transportId: string, shareUrl: string, keyHex: string, downloadPath: string, shutdown: Function }>}
   */
  async start({
    filePath,
    filePaths,
    isMultiFile,
    isDirectory,
    isClipboard,
    clipboardData,
    port,
    bindIp,
    downloadLimit = 1,
    ip,
    token,
    options = {}
  }) {
    const effectiveToken = token !== undefined ? token : options.token;

    const serverHandle = await server.createServer({
      filePath,
      filePaths,
      isMultiFile,
      isDirectory,
      isClipboard,
      clipboardData,
      port,
      bindIp,
      downloadLimit,
      options: {
        ...options,
        token: effectiveToken
      },
      onTransferStart: (currentCount, limit) => {
        this.emit('transfer-start', { currentCount, limit });
      },
      onTransferComplete: (completedCount, limit) => {
        this.emit('transfer-complete', { completedCount, downloadLimit: limit });
      },
      onTransferError: (err) => {
        this.emit('transfer-error', err);
      }
    });

    const keyHex = serverHandle.keyHex;
    const actualPort = (serverHandle.server && serverHandle.server.address && typeof serverHandle.server.address === 'function' && serverHandle.server.address() && serverHandle.server.address().port) || port;
    const hostIp = ip || '127.0.0.1';
    const shareUrl = `http://${hostIp}:${actualPort}/${effectiveToken ? `?t=${encodeURIComponent(effectiveToken)}` : ''}#${keyHex}`;

    return {
      transportId: 'lan',
      shareUrl,
      keyHex,
      downloadPath: serverHandle.downloadPath,
      transferId: serverHandle.transferId,
      shutdown: serverHandle.shutdown
    };
  }
}

/**
 * Automatically chooses between LAN (mDNS) and Mesh (WebRTC + signaling) based on a 5-step decision tree.
 * 
 * Policy steps:
 * 1. forceMesh: If mesh is explicitly forced, choose mesh.
 * 2. forceLan: If LAN is explicitly forced (no-mesh), choose LAN.
 * 3. peers present: If a local peer is already found on LAN, choose LAN.
 * 4. 3s timeout with signal URL: If a signal URL is provided, wait up to 3 seconds (timeoutMs)
 *    for a peer to respond. If a peer appears, choose LAN. If we timeout, fall back to mesh.
 * 5. default LAN: In any other case, default to LAN.
 * 
 * @param {Object} options
 * @param {boolean|string} options.mesh - CLI/config mesh option (true: forceMesh, false: forceLan, otherwise auto)
 * @param {string} [options.signalUrl] - Optional signaling URL
 * @param {Object} [options.mdns] - The mDNS module instance
 * @param {number} [options.timeoutMs] - Wait timeout for boot discovery (default: 3000)
 * @param {boolean} [options.verbose] - If true, logs step decisions to console
 * @returns {Promise<'lan'|'mesh'>} Selected transport
 */
async function pickTransport({ mesh, signalUrl, mdns, timeoutMs = 3000, verbose = false } = {}) {
  // Step 1: forceMesh
  if (mesh === true) {
    if (!signalUrl) {
      throw new Error('Cannot force Mesh: signaling URL is required');
    }
    if (verbose) {
      console.log('[filedrop:transport] Step 1 (forceMesh): Mesh explicitly forced via CLI flag. Selecting Mesh.');
    }
    return 'mesh';
  }

  // Step 2: forceLan
  if (mesh === false) {
    if (verbose) {
      console.log('[filedrop:transport] Step 2 (forceLan): LAN explicitly forced (mesh disabled). Selecting LAN.');
    }
    return 'lan';
  }

  // Step 3: peers present
  if (mdns && typeof mdns.hasPeerFound === 'function' && mdns.hasPeerFound()) {
    if (verbose) {
      console.log('[filedrop:transport] Step 3 (peers present): Local peer already detected via mDNS. Selecting LAN.');
    }
    return 'lan';
  }

  // Step 4: 3s timeout with signal URL
  if (signalUrl) {
    if (verbose) {
      console.log(`[filedrop:transport] Step 4 (boot timeout): Signal URL present (${signalUrl}). Waiting up to ${timeoutMs}ms for mDNS peer arrival...`);
    }

    let peerFoundListener;
    let timer;

    const peerPromise = new Promise((resolve) => {
      if (mdns && typeof mdns.on === 'function') {
        peerFoundListener = () => {
          if (verbose) {
            console.log('[filedrop:transport] Step 4 (boot timeout): mDNS peer arrived mid-boot. Selecting LAN.');
          }
          resolve('lan');
        };
        mdns.on('peer-found', peerFoundListener);
      }
    });

    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        if (verbose) {
          console.log('[filedrop:transport] Step 4 (boot timeout): mDNS peer wait timed out. Selecting Mesh.');
        }
        resolve('mesh');
      }, timeoutMs);
    });

    const result = await Promise.race([peerPromise, timeoutPromise]);

    // Clean up
    if (timer) {
      clearTimeout(timer);
    }
    if (mdns && typeof mdns.removeListener === 'function' && peerFoundListener) {
      mdns.removeListener('peer-found', peerFoundListener);
    }

    return result;
  }

  // Step 5: default LAN
  if (verbose) {
    console.log('[filedrop:transport] Step 5 (default LAN): No signal URL and no peer present. Defaulting to LAN.');
  }
  return 'lan';
}

module.exports = {
  LanTransport,
  pickTransport
};
