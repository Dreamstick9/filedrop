const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const mime = require('mime');
const pkg = require('../package.json');
const VERSION = pkg.version;

const {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_MAX
} = require('./constants');

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
  filePaths = [],
  isMultiFile = false,
  clipboardData = null,
  isClipboard = false,
  port,
  isDirectory = false,
  options = {},
  downloadLimit = 1,
  onTransferStart,
  onTransferComplete,
  onTransferError
}) {
  let fileName;
  if (isClipboard) {
    fileName = 'clipboard.txt';
  } else if (isMultiFile) {
    fileName = 'filedrop-bundle.zip';
  } else if (isDirectory) {
    fileName = path.basename(filePath) + '.zip';
  } else {
    fileName = path.basename(filePath);
  }
  const transferId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  const downloadToken = crypto.randomBytes(16).toString('hex');
  const downloadPath = `/download/${downloadToken}`;
  
  // Generate E2EE Key
  const aesKey = crypto.randomBytes(32);
  const keyHex = aesKey.toString('hex');
  
  let fileStat;
  try {
    if (!isClipboard && !isMultiFile) {
      fileStat = await fs.promises.stat(filePath);
    }
  } catch (err) {
    onTransferError(err);
    throw err;
  }

  let contentType = 'application/octet-stream';
  if (isClipboard) {
    contentType = 'text/plain';
  } else if (isMultiFile || isDirectory) {
    contentType = 'application/zip';
  } else if (filePath) {
    contentType = mime.getType(filePath) || 'application/octet-stream';
  }
  
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  const contentDisposition = `attachment; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFileName}`;

  const version = options.version || VERSION;
  const timeoutMs = (options.timeout != null ? options.timeout : DEFAULT_TIMEOUT_SECONDS) * 1000;
  
  const completedIPs = new Set();
  // Keep active transfer IPs locked for a short settle period so a retry that arrives
  // immediately after a disconnect or finish still hits the 429 guard instead of racing
  // with socket-close cleanup.
  const activeIPs = new Set();
  const sockets = new Set();
  const transferCleanupDelayMs = options.transferCleanupDelay ?? 50;

  // Rate limiting: max requests per window per IP by default
  const rateLimitWindow = options.rateLimitWindow ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const rateLimitMax = options.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX;
  const rateLimitRetryAfter = Math.ceil(rateLimitWindow / 1000);
  const ipRequestCounts = new Map(); // Maps IP -> Array of timestamps

  function checkRateLimit(ip) {
    const now = Date.now();
    let timestamps = ipRequestCounts.get(ip) || [];
    
    // Filter out timestamps outside the rolling window
    timestamps = timestamps.filter(timestamp => (now - timestamp) <= rateLimitWindow);
    
    if (timestamps.length >= rateLimitMax) {
      // Save the cleaned array back before blocking
      ipRequestCounts.set(ip, timestamps);
      return false; // blocked
    }
    
    timestamps.push(now);
    ipRequestCounts.set(ip, timestamps);
    return true; // allowed
  }

  const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipRequestCounts) {
      // If the latest request in the array is ancient, clean up the whole IP
      const validTimestamps = timestamps.filter(t => (now - t) <= rateLimitWindow);
      if (validTimestamps.length === 0) {
        ipRequestCounts.delete(ip);
      } else {
        ipRequestCounts.set(ip, validTimestamps);
      }
    }
  }, rateLimitWindow * 2);
  rateLimitCleanup.unref();

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
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <div class="container">
    ${isClipboard ? `
      <h1 style="font-size: 1.2rem; margin-bottom: 20px; color: #EAEAEA;">Clipboard Received</h1>
      <textarea id="clipText" readonly style="width:100%; height:150px; font-family:monospace; padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white; resize:none; box-sizing:border-box; outline:none; font-size:0.95rem; line-height:1.4;">Loading...</textarea>
      <button id="copyBtn" style="margin-top:20px; padding:12px 24px; border-radius:8px; border:none; background:#0A84FF; color:white; font-weight:bold; font-size:16px; cursor:pointer; width:100%;">Copy to Clipboard</button>
    ` : `
      <h1>${escapeHtml(fileName)}</h1>
      <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
      <div class="status-row">
        <span id="statusText">Connecting...</span>
        <span id="percentText">0%</span>
      </div>
    `}
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

      const setStatus = (txt) => { if (statusEl) statusEl.innerText = txt; };
      const setPercent = (txt) => { if (percentEl) percentEl.innerText = txt; };
      const setProgressWidth = (width) => { if (progressEl) progressEl.style.width = width; };
      const setClipText = (txt) => {
        const textArea = document.getElementById('clipText');
        if (textArea) textArea.value = txt;
      };

      try {
        const hash = window.location.hash.slice(1);
        if (!hash) {
          setStatus("Error: Missing Key");
          setClipText("Error: Missing decryption key in URL.");
          return;
        }
        
        setStatus("Fetching...");
        const response = await fetch('${downloadPath}');
        if (!response.ok) {
          setStatus("Error: Link Expired");
          setClipText("Error: Link expired or already copied.");
          ${isClipboard ? 'window.close();' : ''}
          return;
        }

        const contentLength = response.headers.get('Content-Length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        let loadedBytes = 0;
        const chunks = [];
        if (!response.body) throw new Error("ReadableStream not supported by browser");
        const reader = response.body.getReader();

        setStatus("Downloading...");
        while(true) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedBytes += value.length;
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
            setProgressWidth(percent + "%");
            setPercent(percent + "%");
          } else {
            const mb = (loadedBytes / (1024 * 1024)).toFixed(1);
            setPercent(mb + " MB");
            setProgressWidth("100%");
            if (progressEl) progressEl.style.animation = "pulse 1.5s ease-in-out infinite";
          }
        }

        setStatus("Decrypting...");
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
        
        setStatus("Transfer Complete!");
        setPercent("100%");
        setProgressWidth("100%");

        const blob = new Blob([decryptedBuffer], { type: ${JSON.stringify(contentType)} });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = decodeURIComponent("${encodeURIComponent(fileName)}");

        if (${isClipboard}) {
          const text = new TextDecoder().decode(decryptedBuffer);
          setClipText(text);
          
          document.getElementById('copyBtn').addEventListener('click', () => {
            const btn = document.getElementById('copyBtn');
            const doCopy = () => {
              btn.innerText = 'Copied!';
              btn.style.background = '#30D158';
              window.close();
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(doCopy).catch(err => {
                console.error('navigator.clipboard failed, trying fallback:', err);
                fallbackCopy();
              });
            } else {
              fallbackCopy();
            }
            function fallbackCopy() {
              const dummyTextArea = document.createElement('textarea');
              dummyTextArea.value = text;
              dummyTextArea.style.position = 'fixed';
              dummyTextArea.style.opacity = '0';
              document.body.appendChild(dummyTextArea);
              dummyTextArea.focus();
              dummyTextArea.select();
              try {
                const successful = document.execCommand('copy');
                if (successful) {
                  doCopy();
                } else {
                  btn.innerText = 'Copy Failed';
                  btn.style.background = '#FF453A';
                }
              } catch (err) {
                console.error('Fallback copy failed:', err);
                btn.innerText = 'Copy Failed';
                btn.style.background = '#FF453A';
              }
              document.body.removeChild(dummyTextArea);
            }
          });
        } else {
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          // Security measure: Erase the decryption key from the address bar
          window.history.replaceState({}, document.title, window.location.pathname);
          
          setStatus("Done");
          const h1 = document.querySelector('h1');
          if (h1) h1.innerText = "Download Started - Safe to close";
        }
      } catch (err) {
        setStatus("Decryption Failed");
        setClipText("Error: Decryption failed or link expired.");
        if (statusEl) statusEl.style.color = "#FF453A";
        console.error(err);
        ${isClipboard ? 'window.close();' : ''}
      }
    })();
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const { method, url } = req;

    const clientIp = req.socket.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': String(rateLimitRetryAfter) });
      res.end('Too Many Requests');
      return;
    }
    
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

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Serve the HTML Decryptor Interface
    if (url === '/' || url === `/${encodeURI(fileName)}`) {
      if (completedIPs.has(clientIp)) {
        res.writeHead(410, { 'Content-Type': 'text/plain' });
        res.end('This file has already been transferred.');
        return;
      }
      if (activeIPs.has(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
        res.end('You are already downloading this file.');
        return;
      }
      if (completedIPs.size + activeIPs.size >= downloadLimit) {
        res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '10' });
        res.end('Too Many Requests');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPayload);
      return;
    }

    // Reject unknown paths
    if (url !== downloadPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (completedIPs.has(clientIp) && method === 'GET') {
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

    if (activeIPs.has(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
      res.end('You are already downloading this file.', () => {
        req.socket.destroy();
      });
      return;
    }
    if (completedIPs.size + activeIPs.size >= downloadLimit) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '10' });
      res.end('Too Many Requests', () => {
        req.socket.destroy();
      });
      return;
    }

    if (req.headers.range) {
      res.writeHead(416, { 'Content-Type': 'text/plain' });
      res.end('Range Not Satisfiable');
      return;
    }

    if (method === 'HEAD') {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDisposition);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'close');
      res.setHeader('X-Filedrop-Version', version);
      res.setHeader('X-Transfer-ID', transferId);
      if (!isDirectory && !isClipboard && !isMultiFile) res.setHeader('Content-Length', fileStat.size + 28);
      res.end();
      return;
    }

    // It's the /download endpoint, encrypt and stream
    if (typeof onTransferStart === 'function' && !activeIPs.has(clientIp)) {
      onTransferStart(activeIPs.size + completedIPs.size + 1, downloadLimit);
    }
    activeIPs.add(clientIp);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'close');
    res.setHeader('X-Filedrop-Version', version);
    res.setHeader('X-Transfer-ID', transferId);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
    if (!isDirectory && !isClipboard && !isMultiFile) res.setHeader('Content-Length', fileStat.size + 28);

    let responseFinished = false;
    let transferState = 'pending';
    let cleanupTimer = null;
    let transferConcluded = false;

    const transferTimeout = timeoutMs > 0 ? setTimeout(() => {
      if (transferState === 'pending') {
        transferState = 'timed-out';
        transferConcluded = true;
        req.socket.destroy();
        onTransferError(new Error('ERR_TRANSFER_TIMEOUT'));
      }
    }, timeoutMs) : null;

    const markTransferComplete = () => {
      if (transferState === 'complete' || transferState === 'timed-out') return;
      transferState = 'complete';
      transferConcluded = true;
      if (transferTimeout) clearTimeout(transferTimeout);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      activeIPs.delete(clientIp);
      completedIPs.add(clientIp);
      onTransferComplete(completedIPs.size, downloadLimit);
    };

    const markTransferDisconnected = () => {
      if (transferState === 'complete' || transferState === 'timed-out') return;
      if (transferState === 'disconnect') return;
      transferState = 'disconnect';
      transferConcluded = true;
      if (transferTimeout) clearTimeout(transferTimeout);
      cleanupTimer = setTimeout(() => {
        if (transferState !== 'disconnect') return;
        transferState = 'disconnected';
        activeIPs.delete(clientIp);
        if (sourceStream) sourceStream.destroy();
        onTransferError(new Error('ERR_CLIENT_DISCONNECTED'));
      }, transferCleanupDelayMs);
    };

    res.on('finish', () => {
      responseFinished = true;
      markTransferComplete();
    });

    req.socket.on('close', () => {
      if (responseFinished || res.writableEnded || res.finished) {
        markTransferComplete();
      } else {
        markTransferDisconnected();
      }
    });

    let sourceStream;
    try {
      if (isClipboard) {
        sourceStream = require('stream').Readable.from([Buffer.from(clipboardData, 'utf8')]);
      } else if (isMultiFile) {
        const archive = new archiver.ZipArchive({ zlib: { level: 5 } });
        const addedNames = new Set();
        for (const file of filePaths) {
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
      } else if (isDirectory) {
        const archive = new archiver.ZipArchive({ zlib: { level: 5 } });
        archive.directory(filePath, path.basename(filePath));
        archive.finalize();
        sourceStream = archive;
      } else {
        sourceStream = fs.createReadStream(filePath);
      }
    } catch (err) {
      onTransferError(err);
      return;
    }

    sourceStream.on('error', (err) => {
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
    
    sourceStream.on('data', (chunk) => {
      const encrypted = cipher.update(chunk);
      if (encrypted.length > 0) {
        if (!res.write(encrypted)) {
          sourceStream.pause();
        }
      }
    });

    res.on('drain', () => {
      sourceStream.resume();
    });

    sourceStream.on('end', () => {
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
    clearInterval(rateLimitCleanup);
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
      resolve({ server, shutdown, keyHex, downloadPath });
    });
  });
}

module.exports = { createServer };
