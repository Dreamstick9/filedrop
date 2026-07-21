/**
 * packages/filedrop-signal/server.js
 * Companion signaling and relay server for WebRTC mesh connections.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const minimist = require('minimist');

// Helper to resolve node-forge
let FORGE_ASSET_PATH;
try {
  FORGE_ASSET_PATH = require.resolve('node-forge/dist/forge.min.js');
} catch (err) {
  // Fallback if not installed inside sub-package, resolve from parent node_modules
  FORGE_ASSET_PATH = path.resolve(__dirname, '../../node_modules/node-forge/dist/forge.min.js');
}

// Queue-based Rate Limiter for traffic shaping (throttling)
class RateLimiter {
  constructor(limitBytesPerSec) {
    this.limit = limitBytesPerSec; // Throttle limit
    this.tokens = limitBytesPerSec;
    this.lastRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.limit, this.tokens + (elapsed * this.limit) / 1000);
      this.lastRefill = now;
    }
  }

  throttle(bytes, fn) {
    this.queue.push({ bytes, fn });
    this.processQueue();
  }

  processQueue() {
    if (this.processing) return;
    this.processing = true;

    const run = () => {
      this.refill();
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }
      const item = this.queue[0];
      if (this.tokens >= item.bytes) {
        this.tokens -= item.bytes;
        this.queue.shift();
        item.fn();
        setTimeout(run, 0);
      } else {
        const needed = item.bytes - this.tokens;
        const waitMs = Math.ceil((needed * 1000) / this.limit);
        setTimeout(run, Math.max(10, Math.min(waitMs, 500)));
      }
    };

    run();
  }
}

// Parse server arguments
const args = minimist(process.argv.slice(2), {
  string: ['port', 'bind', 'relay-password'],
  default: {
    port: '8080',
    bind: '0.0.0.0',
    'relay-password': ''
  }
});

const port = parseInt(args.port, 10);
const bindIp = args.bind;
const globalRelayPassword = args['relay-password'];

// In-memory active rooms Map
// roomId -> { sender: WebSocket, receiver: WebSocket, password: string, limiter: RateLimiter }
const rooms = new Map();

// HTTP request handler definition
function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  if (pathname === '/forge.min.js') {
    const stream = fs.createReadStream(FORGE_ASSET_PATH);
    stream.on('error', () => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });
    stream.on('open', () => {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      stream.pipe(res);
    });
    return;
  }

  if (pathname.startsWith('/r/')) {
    const roomId = pathname.split('/')[2];
    if (!roomId) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing Room ID');
      return;
    }

    // Serve Decryptor page targeting WebSocket relay mode
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Download (Relay)</title>
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
    <h1 id="titleText">Relayed Download</h1>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    <div class="status-row">
      <span id="statusText">Connecting to relay...</span>
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
      const titleEl = document.getElementById('titleText');

      const setStatus = (txt) => { if (statusEl) statusEl.innerText = txt; };
      const setPercent = (txt) => { if (percentEl) percentEl.innerText = txt; };
      const setProgressWidth = (width) => { if (progressEl) progressEl.style.width = width; };

      try {
        const hash = window.location.hash.slice(1);
        if (!hash) {
          setStatus("Error: Missing Key");
          return;
        }

        const roomId = "${roomId}";
        const rp = new URLSearchParams(window.location.search).get('rp') || '';

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host;
        const ws = new WebSocket(wsUrl);

        let chunks = [];
        let totalBytes = 0;
        let loadedBytes = 0;
        let filename = 'relayed-download';

        ws.onopen = () => {
          setStatus("Joining room...");
          ws.send(JSON.stringify({
            type: 'join',
            roomId: roomId,
            role: 'receiver',
            password: rp
          }));
        };

        ws.onclose = () => {
          if (statusEl.innerText === "Connecting to relay..." || statusEl.innerText === "Joining room...") {
            setStatus("Disconnected from relay");
          }
        };

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'error') {
            setStatus("Error: " + msg.message);
            ws.close();
            return;
          }
          if (msg.type === 'join-result') {
            if (msg.success) {
              setStatus("Waiting for sender...");
            } else {
              setStatus("Join failed");
              ws.close();
            }
            return;
          }
          if (msg.type === 'meta') {
            totalBytes = msg.size || 0;
            filename = msg.filename || filename;
            if (titleEl) titleEl.innerText = filename;
            setStatus("Downloading (Relayed)...");
            return;
          }
          if (msg.type === 'relay-data') {
            const raw = atob(msg.data);
            const chunk = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
              chunk[i] = raw.charCodeAt(i);
            }
            chunks.push(chunk);
            loadedBytes += chunk.length;

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
            return;
          }
          if (msg.type === 'transfer-complete') {
            ws.send(JSON.stringify({ type: 'transfer-complete-ack' }));
            setTimeout(() => ws.close(), 100);
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
              if (!window.forge) throw new Error("Fallback crypto not loaded.");
              const keyBytesStr = forge.util.hexToBytes(hash);
              const ivStr = u8ToBinaryString(iv);
              const tagLen = 16;
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
              if (!pass) throw new Error("Decryption failed (auth tag mismatch).");

              const decryptedString = decipher.output.getBytes();
              decryptedBuffer = new Uint8Array(decryptedString.length);
              for (let i = 0; i < decryptedString.length; i++) {
                decryptedBuffer[i] = decryptedString.charCodeAt(i);
              }
            }

            setStatus("Transfer Complete!");
            setPercent("100%");
            setProgressWidth("100%");

            const blob = new Blob([decryptedBuffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            window.history.replaceState({}, document.title, window.location.pathname);
            setStatus("Done");
            if (titleEl) titleEl.innerText = "Download Started - Safe to close";
          }
        }
      } catch (err) {
        setStatus("Decryption Failed");
        if (statusEl) statusEl.style.color = "#FF453A";
        console.error(err);
      }
    })();
  </script>
</body>
</html>`);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

// WebSocket Connection handler definition
function handleWebSocketConnection(ws) {
  let wsRoomId = null;
  let wsRole = null;

  ws.on('message', (messageStr) => {
    let msg;
    try {
      msg = JSON.parse(messageStr);
    } catch {
      return; // ignore invalid JSON
    }

    if (msg.type === 'join') {
      const { roomId, role, password } = msg;
      if (!roomId || !role) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing roomId or role' }));
        ws.close();
        return;
      }

      let room = rooms.get(roomId);

      if (!room) {
        if (role === 'receiver') {
          ws.send(JSON.stringify({ type: 'error', message: 'Room empty. Sender must join first.' }));
          ws.close();
          return;
        }
        // Sender creates room
        const roomPassword = password || globalRelayPassword || '';
        room = {
          sender: ws,
          receiver: null,
          password: roomPassword,
          limiter: new RateLimiter(5 * 1024 * 1024) // 5 MiB/s throttle
        };
        rooms.set(roomId, room);
        wsRoomId = roomId;
        wsRole = 'sender';
        ws.send(JSON.stringify({ type: 'join-result', success: true }));
        if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'peer-joined' }));
        }
      } else {
        // Room exists
        if (role === 'sender') {
          ws.send(JSON.stringify({ type: 'error', message: 'Sender already in room' }));
          ws.close();
          return;
        }
        if (room.receiver) {
          ws.send(JSON.stringify({ type: 'error', message: 'Receiver already in room' }));
          ws.close();
          return;
        }

        // Check password challenge
        const expectedPassword = room.password || globalRelayPassword;
        if (expectedPassword && password !== expectedPassword) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid relay password challenge' }));
          ws.close();
          return;
        }

        room.receiver = ws;
        wsRoomId = roomId;
        wsRole = 'receiver';
        ws.send(JSON.stringify({ type: 'join-result', success: true }));

        // Notify sender receiver has joined
        if (room.sender && room.sender.readyState === WebSocket.OPEN) {
          room.sender.send(JSON.stringify({ type: 'peer-joined' }));
        }
      }
    } else if (msg.type === 'signal') {
      const room = rooms.get(wsRoomId);
      if (!room) return;
      const target = (wsRole === 'sender') ? room.receiver : room.sender;
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify(msg));
      }
    } else if (msg.type === 'relay-data') {
      const room = rooms.get(wsRoomId);
      if (!room) return;
      
      const target = (wsRole === 'sender') ? room.receiver : room.sender;
      if (target && target.readyState === WebSocket.OPEN) {
        // Calculate payload size
        const bytes = msg.data ? Math.ceil(msg.data.length * 0.75) : 0;
        
        // ASSERTION: Relay frames are not inspected or decrypted by the server; they are forwarded verbatim.
        room.limiter.throttle(bytes, () => {
          if (target.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(msg));
          }
        });
      }
    } else if (msg.type === 'meta' || msg.type === 'transfer-complete' || msg.type === 'transfer-complete-ack') {
      const room = rooms.get(wsRoomId);
      if (!room) return;
      const target = (wsRole === 'sender') ? room.receiver : room.sender;
      if (target && target.readyState === WebSocket.OPEN) {
        room.limiter.throttle(0, () => {
          if (target.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(msg));
          }
        });
      }
    }
  });

  ws.on('close', () => {
    if (!wsRoomId) return;
    const room = rooms.get(wsRoomId);
    if (!room) return;

    if (wsRole === 'sender') {
      // If sender disconnects, notify receiver and teardown room
      if (room.receiver && room.receiver.readyState === WebSocket.OPEN) {
        room.receiver.send(JSON.stringify({ type: 'error', message: 'Sender disconnected' }));
        room.receiver.close();
      }
      rooms.delete(wsRoomId);
    } else if (wsRole === 'receiver') {
      // If receiver disconnects, notify sender
      room.receiver = null;
      if (room.sender && room.sender.readyState === WebSocket.OPEN) {
        room.sender.send(JSON.stringify({ type: 'peer-left' }));
      }
    }
  });
}

let currentServer = null;
let currentWss = null;
const sockets = new Set();

function stopServerSync() {
  rooms.clear();
  if (currentWss) {
    try { currentWss.close(); } catch {}
    currentWss = null;
  }
  for (const socket of sockets) {
    try { socket.destroy(); } catch {}
  }
  sockets.clear();
  if (currentServer) {
    try { currentServer.close(); } catch {}
    try { currentServer.unref(); } catch {}
    currentServer = null;
  }
}

// Export server control logic for integration tests
function startServer(customPort, customBind) {
  const p = customPort !== undefined ? customPort : port;
  const b = customBind !== undefined ? customBind : bindIp;

  stopServerSync();

  currentServer = http.createServer(handleRequest);
  currentWss = new WebSocket.Server({ server: currentServer });

  currentWss.on('connection', handleWebSocketConnection);
  currentServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    currentServer.listen(p, b, () => {
      resolve(currentServer);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    stopServerSync();
    resolve();
  });
}

if (require.main === module) {
  startServer().then(() => {
    console.log(`Relay signaling server running at http://${bindIp}:${port}`);
  });
}

module.exports = {
  startServer,
  stopServer,
  get server() { return currentServer; },
  get wss() { return currentWss; },
  rooms
};
