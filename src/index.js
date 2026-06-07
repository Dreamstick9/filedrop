#!/usr/bin/env node

const { parseArgs } = require('./cli');
const path = require('path');
const crypto = require('crypto');

// Assumed imports from other agents
const network = require('./network');
const portManager = require('./port');
const mdns = require('./mdns');
const server = require('./server');
const qr = require('./qr');

/**
 * Assumed module interfaces:
 * 
 * network.js:
 *   getInterface(bindIp: string): Promise<string>
 * 
 * port.js:
 *   findAvailablePort(startPort: number, endPort: number): Promise<number>
 * 
 * mdns.js:
 *   announce(options: { name: string, port: number, txt: object }): Promise<void>
 *   teardown(): Promise<void>
 * 
 * server.js:
 *   createServer(options: { filePath: string, port: number, options: object, onTransferStart: () => void, onTransferComplete: () => void, onTransferError: (err: Error) => void }): { shutdown: () => Promise<void>, start: () => Promise<void> }
 * 
 * qr.js:
 *   generateQR(url: string, mode: string): string
 * 
 * ui.js:
 *   renderStart(metadata: object): void
 *   updateStatus(status: string): void
 *   renderSuccess(): void
 */

async function main() {
  // 1. Parse and validate arguments
  const config = parseArgs(process.argv);
  
  // 2. Resolve absolute file path
  // Handled inside parseArgs, which returns an absolute config.filePath

  // 3. Discover network interface -> IP
  let ip;
  try {
    const iface = await network.getInterface(config.bind);
    ip = iface.info.address;
  } catch (err) {
    console.error(`filedrop: error: ${err.message || 'No network interface found'}`);
    process.exit(2);
  }

  // 4. Find available port
  let port;
  try {
    if (config.port) {
      port = await portManager.findAvailablePort(config.port, config.port);
    } else {
      port = await portManager.findAvailablePort(8000, 8999);
    }
  } catch (err) {
    console.error(`filedrop: error: ${err.message || 'Port exhausted'}`);
    process.exit(3);
  }

  const url = `http://${ip}:${port}/`;
  const filename = path.basename(config.filePath);

  // 5. Initialize mDNS module (non-blocking)
  let mdnsName = config.name || filename.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 15) + '-filedrop';
  if (config.mdns) {
    mdns.announce({
      name: mdnsName,
      port: port,
      txt: {
        path: '/',
        file: encodeURIComponent(filename),
        size: config.fileSize.toString(),
        v: '1',
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
      }
    }).catch(err => {
      // fire and forget with error callback
      if (config.verbose) {
        console.error(`mDNS error: ${err.message}`);
      }
    });
  }

  // 6. Initialize HTTP server module
  let transferCompleteResolve;
  let transferErrorReject;
  const transferPromise = new Promise((resolve, reject) => {
    transferCompleteResolve = resolve;
    transferErrorReject = reject;
  });

  let isTransferring = false;
  let timeoutHandle;

  const httpApp = server.createServer({
    filePath: config.filePath,
    port: port,
    options: {
      timeout: config.timeout,
      verbose: config.verbose
    },
    onTransferStart: () => {
      isTransferring = true;
      clearTimeout(timeoutHandle); // reset/cancel connection timeout
      qr.updateStatus('transferring');
    },
    onTransferComplete: () => {
      isTransferring = false;
      transferCompleteResolve();
    },
    onTransferError: (err) => {
      isTransferring = false;
      transferErrorReject(err);
    }
  });

  // 7. Render and print QR code + metadata box
  if (config.qr) {
    const qrString = qr.renderQR(url, { compact: config.qrCompact });
    console.log(qrString);
    if (!config.qrCompact) {
      console.log(qr.renderMetadataBox(filename, config.fileSize + ' bytes', url, config.mdns ? mdnsName : null));
    }
  } else {
    console.log(`URL: ${url}`);
    if (config.mdns) {
      console.log(`mDNS: ${mdnsName}.local`);
    }
  }

  // 8. Start HTTP server (begin accepting connections)
  if (httpApp.start) {
    await httpApp.start();
  }

  // Signal Handling
  let isShuttingDown = false;
  const handleExit = async () => {
    if (isShuttingDown) return;
    
    if (isTransferring) {
      console.log('\nTransfer in progress — waiting for completion...');
      // Wait up to 10 seconds before force-exiting
      setTimeout(() => {
        process.stdout.write('\nForcing exit.\n');
        process.exit(130);
      }, 10000);
      return;
    }

    isShuttingDown = true;
    process.stdout.write('\n'); // Terminal may be mid-line
    console.log('Interrupted. No file was transferred.');
    
    // Call server.shutdown() and mdns.deregister() in parallel
    const shutdownPromise = Promise.all([
      httpApp.shutdown ? httpApp.shutdown().catch(() => {}) : Promise.resolve(),
      config.mdns && mdns.teardown ? mdns.teardown().catch(() => {}) : Promise.resolve()
    ]);
    
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
    
    // Wait for both (with a 2-second timeout)
    await Promise.race([shutdownPromise, timeoutPromise]);
    process.exit(130);
  };
  
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  // 9. Set connection timeout timer
  if (config.timeout > 0) {
    timeoutHandle = setTimeout(async () => {
      console.error(`\nTransfer timed out after ${config.timeout} seconds.`);
      if (config.mdns && mdns.teardown) await mdns.teardown().catch(() => {});
      if (httpApp.shutdown) await httpApp.shutdown().catch(() => {});
      process.exit(5);
    }, config.timeout * 1000);
  }

  try {
    // 10. Await onTransferComplete or onTransferError
    await transferPromise;
    clearTimeout(timeoutHandle);
    
    // 11. Update terminal status line
    qr.updateStatus('done');
    
    // 12. Deregister mDNS
    if (config.mdns && mdns.teardown) {
      await mdns.teardown().catch(() => {});
    }
    
    // 13. Shutdown HTTP server
    if (httpApp.shutdown) {
      await httpApp.shutdown().catch(() => {});
    }
    
    // 14. Exit process with code 0
    process.exit(0);

  } catch (err) {
    clearTimeout(timeoutHandle);
    console.error(`\nTransfer error: ${err.message}`);
    
    if (config.mdns && mdns.teardown) {
      await mdns.teardown().catch(() => {});
    }
    if (httpApp.shutdown) {
      await httpApp.shutdown().catch(() => {});
    }
    
    if (err.message && err.message.includes('ERR_CLIENT_DISCONNECTED')) {
      process.exit(6);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
