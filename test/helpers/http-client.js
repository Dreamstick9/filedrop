const http = require('http');

/**
 * A thin wrapper around http.get that returns a Promise.
 * 
 * @param {string} url - The URL to GET.
 * @param {Object} options - Request options.
 * @returns {Promise<{ statusCode: number, headers: Object, body: Buffer }>}
 */
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

module.exports = { httpClient };
