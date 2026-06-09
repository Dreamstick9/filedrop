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

module.exports = {
  validateToken,
  createConnectionLimiter
};
