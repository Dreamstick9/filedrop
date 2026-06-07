/**
 * @fileoverview Mock mDNS Responder / Module stub
 * Exports a compatible API with `mdns.js` but fakes the network logic,
 * making it suitable for integration tests where real multicast is blocked.
 */

let isRegistered = false;
let publishedConfig = null;

async function announce(config) {
  isRegistered = true;
  publishedConfig = config;
  
  let baseName = config.mdnsName || config.mdnsNameOverride || 'mock-filedrop';
  baseName = baseName.replace(/\.local$/, '');
  
  // Simulate probing delay
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ name: baseName, mdnsAvailable: true });
    }, 50);
  });
}

async function deregister() {
  if (!isRegistered) return Promise.resolve();
  
  return new Promise(resolve => {
    setTimeout(() => {
      isRegistered = false;
      publishedConfig = null;
      resolve();
    }, 50);
  });
}

function __getPublishedConfig() {
  return publishedConfig;
}

function __getIsRegistered() {
  return isRegistered;
}

module.exports = {
  announce,
  deregister,
  __getPublishedConfig,
  __getIsRegistered
};
