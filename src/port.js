const net = require('net');
const os = require('os');
const path = require('path');

const MIN_PORT = 1024;
const MAX_PORT = 65535;

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
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    console.error(`filedrop: error: Port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`);
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

function bind(lifecycle) {
  lifecycle.on('port:resolve', async (data) => {
    try {
      let resolvedPort;
      if (data.port) {
        resolvedPort = await module.exports.getSpecificPort(data.port);
      } else {
        resolvedPort = await module.exports.findAvailablePort(data.startPort ?? 8000, data.endPort ?? 8999);
      }
      lifecycle.emit('port:resolved', resolvedPort);
    } catch (err) {
      lifecycle.emit('port:error', err);
    }
  });
}

/**
 * Resets the module-level firewall warning printed state.
 * For testing purposes only.
 */
function _resetFirewallWarning() {
  firewallWarningPrinted = false;
}

module.exports = {
  MIN_PORT,
  MAX_PORT,
  findAvailablePort,
  getSpecificPort,
  isPortAvailable,
  bind,
  _resetFirewallWarning,
};
