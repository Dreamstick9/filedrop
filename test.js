const { createServer } = require('./src/server.js');
const fs = require('fs');
const http = require('http');

async function run() {
  fs.writeFileSync('dummy.txt', 'hello world');
  const { server, shutdown } = await createServer({
    filePath: require('path').resolve('dummy.txt'),
    port: 0,
    options: {},
    onTransferComplete: () => console.log('Complete!'),
    onTransferError: (err) => console.error('Error:', err)
  });

  const port = server.address().port;
  console.log('Server running on port', port);

  http.get(`http://localhost:${port}/`, (res) => {
    console.log('Status Code:', res.statusCode);
    res.on('data', (chunk) => console.log('BODY:', chunk.toString()));
    res.on('end', () => {
      console.log('Response ended');
      shutdown();
    });
  }).on('error', (err) => {
    console.error('Request error:', err);
  });
}
run().catch(console.error);
