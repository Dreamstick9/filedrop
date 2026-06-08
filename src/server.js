const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');

/**
 * Initializes and starts the ephemeral HTTP server for filedrop.
 * 
 * @param {Object} params 
 * @param {string} params.filePath - Absolute path to the file or directory.
 * @param {number} params.port - The port to bind to.
 * @param {Object} params.options - Server options (e.g. timeout, version, isDir, receive, limit, pin).
 * @param {Function} params.onTransferStart - Callback when transfer begins.
 * @param {Function} params.onTransferComplete - Callback when transfer completes successfully.
 * @param {Function} params.onTransferError - Callback when a fatal error occurs.
 * @returns {Promise<{ server: http.Server, shutdown: () => Promise<void>, start: () => Promise<void> }>}
 */
async function createServer({
  filePath,
  port,
  options = {},
  onTransferStart,
  onTransferComplete,
  onTransferError
}) {
  const app = express();
  
  const version = options.version || '1.0.0';
  const cookieSecret = crypto.randomBytes(32).toString('hex');
  
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(cookieSecret));

  const fileName = path.basename(filePath);
  const isDir = options.isDir;
  const receiveMode = options.receive;
  const transferLimit = options.limit || 1;
  const pin = options.pin;
  
  let successfulTransfers = 0;
  const activeDevices = new Set();
  const successfulDevices = new Set();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 requests per windowMs
    message: "Too many login attempts, please try again later"
  });

  // Authentication Middleware
  const requireAuth = (req, res, next) => {
    if (!receiveMode && successfulTransfers >= transferLimit && !successfulDevices.has(req.signedCookies.deviceId)) {
      return res.status(410).send('This transfer is no longer available.');
    }
    
    if (req.signedCookies.auth === 'true' && req.signedCookies.deviceId) {
      if (!receiveMode && successfulDevices.has(req.signedCookies.deviceId) && req.path === '/') {
        return res.status(410).send('You have already completed this transfer.');
      }
      return next();
    }
    res.redirect('/login');
  };

  // Login Page
  app.get('/login', (req, res) => {
    if (successfulTransfers >= transferLimit) {
      return res.status(410).send('This transfer is no longer available.');
    }
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center; }
          input[type="text"] { width: 100%; padding: 15px; margin: 20px 0; border-radius: 8px; border: none; background-color: #2d2d2d; color: white; font-size: 24px; text-align: center; letter-spacing: 5px; box-sizing: border-box; }
          button { background-color: #007aff; color: white; border: none; padding: 15px 30px; border-radius: 8px; font-size: 18px; cursor: pointer; width: 100%; }
          button:hover { background-color: #0056b3; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Enter PIN</h2>
          <form method="POST" action="/login">
            <input type="text" name="pin" pattern="\\d*" maxlength="4" required autofocus>
            <button type="submit">Unlock</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  // Login Action
  app.post('/login', limiter, (req, res) => {
    if (req.body.pin === pin) {
      const deviceId = crypto.randomUUID();
      res.cookie('auth', 'true', { signed: true, httpOnly: true, maxAge: 3600000 });
      res.cookie('deviceId', deviceId, { signed: true, httpOnly: true, maxAge: 3600000 });
      res.redirect('/');
    } else {
      res.status(401).send('Invalid PIN. <a href="/login">Try again</a>');
    }
  });

  if (receiveMode) {
    // Receive Mode Setup
    const storage = multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, filePath);
      },
      filename: function (req, file, cb) {
        const safeName = path.basename(file.originalname);
        cb(null, safeName);
      }
    });
    const upload = multer({ storage: storage });

    const uploadMulti = multer({ storage: storage }).array('files');

    app.get('/', requireAuth, (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center; }
            input[type="file"] { margin: 20px 0; }
            button { background-color: #34c759; color: white; border: none; padding: 15px 30px; border-radius: 8px; font-size: 18px; cursor: pointer; width: 100%; }
            button:hover { background-color: #28a745; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Upload Files</h2>
            <form method="POST" action="/upload" enctype="multipart/form-data">
              <input type="file" name="files" multiple required>
              <button type="submit">Send to Computer</button>
            </form>
          </div>
        </body>
        </html>
      `);
    });

    app.post('/upload', requireAuth, uploadMulti, (req, res) => {
      if (req.files && req.files.length > 0) {
        successfulDevices.add(req.signedCookies.deviceId);
        if (onTransferStart) onTransferStart();

        req.files.forEach(f => {
          // Sanitize log output to prevent console injection
          const safeOriginalName = f.originalname.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
          console.log(`\nReceived: ${safeOriginalName}`);
        });

        // Note: receive mode should stay open indefinitely. We DO NOT increment successfulTransfers
        // or call onTransferComplete() to avoid shutting down the server. The user will stop it with Ctrl+C.
        res.send('Files uploaded successfully! <a href="/">Upload more</a> or close this page.');
      } else {
        res.status(400).send('Upload failed.');
      }
    });

  } else {
    // Send Mode Setup
    app.get('/', requireAuth, async (req, res) => {
      if (onTransferStart) onTransferStart();
      const deviceId = req.signedCookies.deviceId;
      
      const onStreamComplete = () => {
         successfulTransfers++;
         successfulDevices.add(deviceId);
         if (successfulTransfers >= transferLimit) {
           onTransferComplete();
         }
      };

      if (isDir) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);

        const archive = archiver('zip', { zlib: { level: 1 } });

        archive.on('error', function(err) {
          onTransferError(err);
        });

        res.on('finish', () => {
            onStreamComplete();
        });

        res.on('close', () => {
          if (!res.writableEnded) {
            archive.abort();
          }
        });

        archive.pipe(res);
        archive.directory(filePath, fileName);
        await archive.finalize();

      } else {
        const fileStat = await fs.promises.stat(filePath);
        const contentType = mime.getType(filePath) || 'application/octet-stream';
        const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        const contentDisposition = `attachment; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFileName}`;

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileStat.size);
        res.setHeader('Content-Disposition', contentDisposition);

        const fileStream = fs.createReadStream(filePath);

        fileStream.on('error', (err) => {
          onTransferError(err);
          req.socket.destroy();
        });

        res.on('finish', () => {
          onStreamComplete();
        });

        res.on('close', () => {
          if (!res.writableEnded) {
            fileStream.destroy();
          }
        });

        fileStream.pipe(res);
      }
    });
  }

  const server = http.createServer(app);
  const sockets = new Set();

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
        try {
          options.onShutdown();
        } catch (err) {
          if (options.verbose) console.error('mDNS unregister error:', err);
        }
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

  const start = () => {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            server.removeListener('error', reject);
            resolve();
        });
      });
  };

  return { server, shutdown, start };
}

module.exports = { createServer };
