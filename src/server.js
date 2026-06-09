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
  <title>Download</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #000; color: #fff; margin: 0; }
    .container { text-align: center; padding: 30px; border-radius: 16px; background: rgba(20,20,20,0.8); backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.5); border: 1px solid #333; width: 80%; max-width: 320px; }
    h1 { font-size: 1.2rem; margin-bottom: 24px; word-break: break-all; color: #EAEAEA; }
    .progress-bar { width: 100%; height: 12px; background: #222; border-radius: 6px; overflow: hidden; margin-bottom: 12px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.8); }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #0A84FF, #5E5CE6); width: 0%; transition: width 0.1s linear; box-shadow: 0 0 10px rgba(10,132,255,0.5); }
    .status-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(fileName)}</h1>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    <div class="status-row">
      <span id="statusText">Connecting...</span>
      <span id="percentText">0%</span>
    </div>
  </div>
  <script src="/forge.min.js"></script>
  <script>
    function u8ToBinaryString(u8) {
      let res = '';
      const chunk = 10000;
      for (let i = 0; i < u8.length; i += chunk) {
        res += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      }
      return res;
    }

    (async function() {
      const statusEl = document.getElementById('statusText');
      const percentEl = document.getElementById('percentText');
      const progressEl = document.getElementById('progress');

      try {
        const hash = window.location.hash.slice(1);
        if (!hash) {
          statusEl.innerText = "Error: Missing Key";
          return;
        }
        
        statusEl.innerText = "Fetching...";
        const response = await fetch('/download');
        if (!response.ok) {
          statusEl.innerText = "Error: Link Expired";
          return;
        }

        const contentLength = response.headers.get('Content-Length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        let loadedBytes = 0;
        const chunks = [];
        const reader = response.body.getReader();

        statusEl.innerText = "Downloading...";
        while(true) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedBytes += value.length;
          if (totalBytes > 0) {
            const percent = Math.round((loadedBytes / totalBytes) * 100);
            progressEl.style.width = percent + "%";
            percentEl.innerText = percent + "%";
          }
        }

        statusEl.innerText = "Decrypting...";
        const encryptedBuffer = new Uint8Array(loadedBytes);
        let position = 0;
        for (let chunk of chunks) {
          encryptedBuffer.set(chunk, position);
          position += chunk.length;
        }
        
        const iv = new Uint8Array(encryptedBuffer.slice(0, 12));
        const data = new Uint8Array(encryptedBuffer.slice(12));
        
        let decryptedBuffer;
        if (window.crypto && window.crypto.subtle) {
          const keyBytes = new Uint8Array(hash.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          const key = await crypto.subtle.importKey(
            "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
          );
          decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            data
          );
        } else {
          console.log("Using node-forge fallback for decryption.");
          if (!window.forge) throw new Error("Cryptography fallback not loaded.");
          
          const keyBytesStr = forge.util.hexToBytes(hash);
          const ivStr = u8ToBinaryString(iv);
          
          const tagLen = 16;
          if (data.length < tagLen) throw new Error("Ciphertext too short.");
          
          const cipherBytesStr = u8ToBinaryString(data.subarray(0, data.length - tagLen));
          const tagStr = u8ToBinaryString(data.subarray(data.length - tagLen));
          
          const decipher = forge.cipher.createDecipher('AES-GCM', keyBytesStr);
          decipher.start({
            iv: ivStr,
            tagLength: 128,
            tag: forge.util.createBuffer(tagStr)
          });
          decipher.update(forge.util.createBuffer(cipherBytesStr));
          const pass = decipher.finish();
          if (!pass) throw new Error("Decryption failed (authentication tag mismatch).");
          
          const decryptedString = decipher.output.getBytes();
          decryptedBuffer = new Uint8Array(decryptedString.length);
          for (let i = 0; i < decryptedString.length; i++) {
            decryptedBuffer[i] = decryptedString.charCodeAt(i);
          }
        }
        
        statusEl.innerText = "Transfer Complete!";
        percentEl.innerText = "100%";
        progressEl.style.width = "100%";

        const blob = new Blob([decryptedBuffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = decodeURIComponent("${encodeURIComponent(fileName)}");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setTimeout(() => {
          window.close();
          window.history.back();
        }, 3000);
      } catch (err) {
        statusEl.innerText = "Decryption Failed";
        statusEl.style.color = "#FF453A";
        console.error(err);
      }
    })();
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const { method, url } = req;
    
    if (url === '/forge.min.js') {
      const forgePath = path.join(__dirname, '../node_modules/node-forge/dist/forge.min.js');
      const forgeStream = fs.createReadStream(forgePath);
      forgeStream.on('error', () => {
        if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      });
      forgeStream.on('open', () => {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'max-age=31536000' });
        forgeStream.pipe(res);
      });
      return;
    }

    // Serve the HTML Decryptor Interface
    if (url === '/' || url === `/${encodeURI(fileName)}`) {
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

    if (method === 'HEAD') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'close');
      res.setHeader('X-Filedrop-Version', version);
      res.setHeader('X-Transfer-ID', transferId);
      res.end();
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
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length');

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
      if (encrypted.length > 0) {
        if (!res.write(encrypted)) {
          fileStream.pause();
        }
      }
    });

    res.on('drain', () => {
      fileStream.resume();
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
