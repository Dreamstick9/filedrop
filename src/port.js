const net = require('net');
const os = require('os');
const path = require('path');

let firewallWarningPrinted = false;

function printFirewallWarningIfNeeded() {
  if (os.platform() === 'darwin' && !firewallWarningPrinted) {
    const execName = path.basename(process.execPath);
    if (execName === 'node') {
      console.log('Note: macOS may prompt to allow network connections for Node.js. Click Allow to enable file transfer.');
      firewallWarningPrinted = true;
    }
  }
}

/**
 * Check if a port is available by attempting to bind a TCP server to it.
 * Binds specifically to 0.0.0.0 (IPv4 only) to avoid IPv6 dual-stack complexities.
 * Documented decision: Binding to '::' behaves differently across operating systems
 * and can add complexity. We explicitly bind to '0.0.0.0'.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      // If it's already in use, or permission denied, it's not available
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    // Explicitly bind to 0.0.0.0
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Finds an available port in the specified range.
 * Checks sequentially to avoid TOCTOU race conditions.
 * Maximum candidates to try is 20.
 *
 * @param {number} startPort
 * @param {number} endPort
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort = 8000, endPort = 8999) {
  const maxAttempts = 20;
  let attempts = 0;

  for (let port = startPort; port <= endPort; port++) {
    if (attempts >= maxAttempts) {
      break;
    }
    
    const available = await isPortAvailable(port);
    if (available) {
      printFirewallWarningIfNeeded();
      return port;
    }
    
    attempts++;
  }

  throw new Error(`ERR_PORT_EXHAUSTED: No available ports in range: ${startPort}-${Math.min(endPort, startPort + maxAttempts - 1)}`);
}

/**
 * Validates and binds to a specific port requested by the user.
 * Exits with code 3 if the port is already in use.
 *
 * @param {number} port
 * @returns {Promise<number>}
 */
async function getSpecificPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(`filedrop: error: Port must be an integer between 1024 and 65535.`);
    process.exit(1);
  }

  const available = await isPortAvailable(port);
  if (available) {
    printFirewallWarningIfNeeded();
    return port;
  }

  console.error(`Port ${port} is already in use. Try --port ${port + 1} or omit --port for auto-selection.`);
  process.exit(3);
}

module.exports = {
  findAvailablePort,
  getSpecificPort,
  isPortAvailable,
};
