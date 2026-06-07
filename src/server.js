const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime');
const crypto = require('crypto');

/**
 * Initializes and starts the ephemeral HTTP server for filedrop.
 * 
 * @param {Object} params 
 * @param {string} params.filePath - Absolute path to the file.
 * @param {number} params.port - The port to bind to.
 * @param {Object} params.options - Server options (e.g. timeout, version, onShutdown).
 * @param {Function} params.onTransferComplete - Callback when transfer completes successfully.
 * @param {Function} params.onTransferError - Callback when a fatal error occurs.
 * @returns {Promise<{ server: http.Server, shutdown: () => Promise<void> }>}
 */
async function createServer({
  filePath,
  port,
  options = {},
  onTransferComplete,
  onTransferError
}) {
  const fileName = path.basename(filePath);
  const transferId = crypto.randomUUID();
  
  // file should be pre-validated, but we stat it to get the size
  let fileStat;
  try {
    fileStat = await fs.promises.stat(filePath);
  } catch (err) {
    onTransferError(err);
    throw err;
  }

  // Infer content type
  const contentType = mime.getType(filePath) || 'application/octet-stream';
  
  // Encode filename for Content-Disposition (RFC 5987)
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  const contentDisposition = `attachment; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFileName}`;

  const version = options.version || '1.0.0';
  const timeoutMs = options.timeout ? options.timeout * 1000 : 60000;
  
  let hasTransferred = false;
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    // Reject subsequent or concurrent GET requests
    if (hasTransferred && req.method === 'GET') {
      res.writeHead(410, {
        'Content-Type': 'text/plain',
        'X-Filedrop-Version': version,
        'X-Transfer-ID': transferId
      });
      res.end('This file has already been transferred.', () => {
        req.socket.destroy();
      });
      return;
    }

    const { method, url } = req;
    
    // Only accept / and /<filename>
    const validPaths = ['/', `/${encodeURI(fileName)}`];
    if (!validPaths.includes(url)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Only allow GET and HEAD
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Reject partial requests
    if (req.headers.range) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileStat.size}`,
        'Content-Type': 'text/plain'
      });
      res.end('Range Not Satisfiable');
      return;
    }

    // Set standard response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileStat.size);
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'close');
    res.setHeader('X-Filedrop-Version', version);
    res.setHeader('X-Transfer-ID', transferId);

    if (method === 'HEAD') {
      res.end();
      return;
    }

    // This is the first GET request
    hasTransferred = true;

    let responseFinished = false;
    let transferConcluded = false;

    // Start transfer timeout
    const transferTimeout = setTimeout(() => {
      if (!transferConcluded) {
        transferConcluded = true;
        req.socket.destroy();
        onTransferError(new Error('ERR_TRANSFER_TIMEOUT'));
      }
    }, timeoutMs);

    res.on('finish', () => {
      responseFinished = true;
    });

    req.socket.on('close', () => {
      if (transferConcluded) return;
      transferConcluded = true;
      clearTimeout(transferTimeout);
      
      if (responseFinished) {
        onTransferComplete();
      } else {
        if (fileStream) fileStream.destroy();
        onTransferError(new Error('ERR_CLIENT_DISCONNECTED'));
      }
    });

    // Stream the file
    let fileStream;
    try {
      fileStream = fs.createReadStream(filePath);
    } catch (err) {
      onTransferError(err);
      return;
    }

    fileStream.on('error', (err) => {
      if (transferConcluded) return;
      transferConcluded = true;
      clearTimeout(transferTimeout);
      
      // Abort response
      req.socket.destroy();
      
      if (err.code === 'EMFILE') {
        onTransferError(new Error('ERR_TOO_MANY_OPEN_FILES'));
      } else {
        onTransferError(err);
      }
    });

    fileStream.pipe(res);
  });

  // Track all sockets to destroy them on shutdown
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  /**
   * Graceful shutdown sequence
   * @returns {Promise<void>}
   */
  const shutdown = () => {
    return new Promise((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      // 5. Times out after 3 seconds and force-resolves regardless
      const forceTimeout = setTimeout(finish, 3000);

      // 3. Unregisters the mDNS service (via injected callback)
      if (typeof options.onShutdown === 'function') {
        try {
          options.onShutdown();
        } catch (err) {
          if (options.verbose) {
            console.error('mDNS unregister error:', err);
          }
        }
      }

      // 1. Calls server.close() to stop accepting new connections
      server.close(() => {
        clearTimeout(forceTimeout);
        finish();
      });

      // 2. Destroys any open sockets
      for (const socket of sockets) {
        socket.destroy();
      }
    });
  };

  return new Promise((resolve, reject) => {
    // Listen to error only for binding issues (e.g. EADDRINUSE)
    server.once('error', reject);
    
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolve({ server, shutdown });
    });
  });
}

module.exports = { createServer };
