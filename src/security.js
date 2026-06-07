const path = require('path');
const readline = require('readline');

/**
 * Validates the security token in the request URL query string.
 * @param {string} url - The request URL
 * @param {string} token - The required token
 * @returns {boolean} - True if valid, false otherwise
 */
function validateToken(url, token) {
  if (!token) return true; // No token required
  try {
    const parsedUrl = new URL(url, 'http://localhost');
    const requestToken = parsedUrl.searchParams.get('t');
    return requestToken === token;
  } catch (err) {
    return false;
  }
}

/**
 * Creates a connection limiter middleware to prevent connection flooding.
 * @param {number} maxConnections - Maximum allowed concurrent connections
 * @returns {Object} Connection limiter with handleConnection method
 */
function createConnectionLimiter(maxConnections = 3) {
  let currentConnections = 0;

  return {
    handleConnection: (socket, rejectCallback) => {
      if (currentConnections >= maxConnections) {
        rejectCallback();
        return false;
      }
      currentConnections++;
      socket.once('close', () => {
        currentConnections--;
      });
      return true;
    }
  };
}

/**
 * Checks if a file is potentially sensitive based on heuristic patterns.
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if potentially sensitive
 */
function isSensitiveFile(filePath) {
  const fileName = path.basename(filePath).toLowerCase();
  const sensitivePatterns = [
    /\.pem$/,
    /\.key$/,
    /\.env.*$/,
    /^id_rsa/,
    /^credentials/
  ];

  return sensitivePatterns.some(pattern => pattern.test(fileName));
}

/**
 * Prompts the user for confirmation if the file is sensitive.
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>} True if user confirms or file is not sensitive
 */
async function confirmSensitiveFile(filePath) {
  if (!isSensitiveFile(filePath)) {
    return true;
  }

  console.log(`\x1b[33mWarning: this file may contain sensitive data. Proceed? [y/N]\x1b[0m`);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

module.exports = {
  validateToken,
  createConnectionLimiter,
  isSensitiveFile,
  confirmSensitiveFile
};
