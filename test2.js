const { createServer } = require('./src/server.js');
const fs = require('fs');
const http = require('http');
// Use cleanupTempFiles after shutdown
await shutdown();
try {
  cleanupTempFiles();
} catch (err) {
  console.error('temp file cleanup failed:', err);
  process.exitCode = 1;
}

// Also: dead import
const { createTempFile } = require('./test/helpers/create-temp-file.js');
if (typeof createTempFile !== 'function') {
  console.warn('createTempFile imported but never used');
}
// Use cleanupTempFiles after shutdown
await shutdown();
cleanupTempFiles();

function httpClient(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { ...options }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const filePath = createTempFile(1024, '.txt');
  let transferCompleted = false;

  const { server, shutdown } = await createServer({
    filePath,
    port: 0,
    onTransferComplete: () => { transferCompleted = true; },
    onTransferError: (err) => { console.log('Transfer Error:', err); }
  });

  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  
  const res = await httpClient(url);
  console.log('Got response', res.statusCode);

  await new Promise(r => setTimeout(r, 50));
  
  await shutdown();
  cleanupTempFiles();
}

run().catch(console.error);
