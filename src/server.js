const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

async function createServer({
  filePath,
  port,
  options = {},
  onTransferStart,
  onTransferComplete,
  onTransferError
}) {
  const fileName = path.basename(filePath);
  const transferId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  
  // Generate E2EE Key
  const aesKey = crypto.randomBytes(32);
  const keyHex = aesKey.toString('hex');
  
  let fileStat;
  try {
    fileStat = await fs.promises.stat(filePath);
  } catch (err) {
    onTransferError(err);
    throw err;
  }

  // Use application/octet-stream to force download
  const contentType = 'application/octet-stream';
  
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  const contentDisposition = `attachment; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFileName}`;

  const version = options.version || '1.0.0';
  const timeoutMs = options.timeout ? options.timeout * 1000 : 60000;
  
  let hasTransferred = false;
  const sockets = new Set();

  const htmlPayload = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Download ${escapeHtml(fileName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #000; color: #fff; margin: 0; }
    .container { text-align: center; padding: 20px; border-radius: 12px; background: #111; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
    h1 { font-size: 1.5rem; margin-bottom: 8px; word-break: break-all; }
    p { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    .progress-bar { width: 100%; max-width: 300px; height: 8px; background: #333; border-radius: 4px; margin: 0 auto; overflow: hidden; }
    .progress-fill { height: 100%; background: #0A84FF; width: 0%; transition: width 0.2s; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(fileName)}</h1>
    <p id="status">Decrypting & Downloading...</p>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
  </div>
  <script>
    (async function() {
      const statusEl = document.getElementById('status');
      const progressEl = document.getElementById('progress');
      try {
        const hash = window.location.hash.slice(1);
        if (!hash) throw new Error("Missing decryption key in URL");
        
        const keyBytes = new Uint8Array(hash.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const key = await crypto.subtle.importKey(
          "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
        );

        statusEl.innerText = "Downloading encrypted file...";
        const response = await fetch('/download');
        if (!response.ok) throw new Error("File not found or already transferred.");
        
        const encryptedBuffer = await response.arrayBuffer();
        statusEl.innerText = "Decrypting locally...";
        
        const iv = encryptedBuffer.slice(0, 12);
        const data = encryptedBuffer.slice(12);
        
        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(iv) },
          key,
          data
        );
        
        statusEl.innerText = "Saving file...";
        progressEl.style.width = "100%";
        
        const blob = new Blob([decryptedBuffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "${escapeHtml(fileName)}";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        statusEl.innerText = "Transfer Complete! You can close this page.";
      } catch (err) {
        statusEl.innerText = "Error: " + err.message;
        statusEl.style.color = "#FF453A";
        progressEl.style.background = "#FF453A";
        console.error(err);
      }
    })();
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const { method, url } = req;
    
    // Serve the HTML Decryptor Interface
    if (url === '/' || url === \`/\${encodeURI(fileName)}\`) {
      if (hasTransferred) {
        res.writeHead(410, { 'Content-Type': 'text/plain' });
        res.end('This file has already been transferred.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPayload);
      return;
    }

    // Reject unknown paths
    if (url !== '/download') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (hasTransferred && method === 'GET') {
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

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    if (req.headers.range) {
      res.writeHead(416, { 'Content-Type': 'text/plain' });
      res.end('Range Not Satisfiable');
      return;
    }

    // It's the /download endpoint, encrypt and stream
    if (typeof onTransferStart === 'function' && !hasTransferred) {
      onTransferStart();
    }
    hasTransferred = true;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'close');
    res.setHeader('X-Filedrop-Version', version);
    res.setHeader('X-Transfer-ID', transferId);

    if (method === 'HEAD') {
      res.end();
      return;
    }

    let responseFinished = false;
    let transferConcluded = false;

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
      req.socket.destroy();
      
      if (err.code === 'EMFILE') {
        onTransferError(new Error('ERR_TOO_MANY_OPEN_FILES'));
      } else {
        onTransferError(err);
      }
    });

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    
    // Write IV first
    res.write(iv);
    
    fileStream.on('data', (chunk) => {
      const encrypted = cipher.update(chunk);
      if (encrypted.length > 0) res.write(encrypted);
    });

    fileStream.on('end', () => {
      const finalBuffer = cipher.final();
      if (finalBuffer.length > 0) res.write(finalBuffer);
      const authTag = cipher.getAuthTag();
      res.end(authTag);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  const shutdown = () => {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const forceTimeout = setTimeout(finish, 3000);
      
      if (typeof options.onShutdown === 'function') {
        try { options.onShutdown(); } catch (err) { }
      }

      server.close(() => {
        clearTimeout(forceTimeout);
        finish();
      });

      for (const socket of sockets) {
        socket.destroy();
      }
    });
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      // Expose keyHex here
      resolve({ server, shutdown, keyHex });
    });
  });
}

module.exports = { createServer };
