const { createServer } = require('./src/server.js');
const fs = require('fs');
const http = require('http');
const { createTempFile, cleanupTempFiles } = require('./test/helpers/create-temp-file.js');

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
const tempFileName = 'temp.txt';
fs.writeFileSync(tempFileName, 'temp content');
// ... rest of the code
fs.unlinkSync(tempFileName);
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
