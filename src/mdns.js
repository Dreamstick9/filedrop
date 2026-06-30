/**
 * @fileoverview mDNS Broadcasting Module for filedrop
 * 
 * Justification for library choice: 
 * We use `multicast-dns` directly rather than the higher-level `bonjour` 
 * library because it provides a pure JavaScript implementation with minimal 
 * dependencies. It avoids the native OS bindings (and gyp compilation) 
 * required by `mdns`, and is lighter than `bonjour` while giving us the 
 * fine-grained control needed to implement custom conflict detection (probing), 
 * specific TXT record formatting, and controlled graceful teardowns.
 */

const os = require('os');
const path = require('path');
const mDNS = require('multicast-dns');

let mdnsInstance = null;
let currentRecords = [];
let isRegistered = false;
let activeServiceName = '';
let activeHostName = '';
let activeOnQuery = null;

function generateBaseName(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const stripped = base.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 15);
  return `${stripped}-filedrop`;
}

function buildRecords(serviceName, hostName, ip, port, txtConfig) {
  const serviceInstanceName = `${serviceName}._http._tcp.local`;
  const typeName = `_http._tcp.local`;
  const hostTarget = `${hostName}.local`;

  const txtData = [
    Buffer.from(`path=/`),
    Buffer.from(`file=${encodeURIComponent(txtConfig.filename)}`),
    Buffer.from(`size=${txtConfig.size}`),
    Buffer.from(`v=1`),
    Buffer.from(`id=${txtConfig.transferId}`)
  ];

  return [
    {
      name: typeName,
      type: 'PTR',
      ttl: 120,
      data: serviceInstanceName
    },
    {
      name: serviceInstanceName,
      type: 'SRV',
      ttl: 120,
      data: {
        target: hostTarget,
        port: port,
        weight: 0,
        priority: 0
      }
    },
    {
      name: serviceInstanceName,
      type: 'TXT',
      ttl: 120,
      data: txtData
    },
    {
      name: hostTarget,
      type: 'A',
      ttl: 120,
      data: ip
    }
  ];
}

function makeOnQuery(verbose) {
  return (packet) => {
    if (!mdnsInstance || currentRecords.length === 0) return;

    const needsResponse = packet.questions && packet.questions.some(q => {
      return q.name === `_http._tcp.local` ||
        q.name === `${activeServiceName}._http._tcp.local` ||
        q.name === `${activeHostName}.local`;
    });

    if (needsResponse) {
      try {
        mdnsInstance.respond({ answers: currentRecords }, (err) => {
          if (err) {
            console.warn(`[filedrop:mDNS] respond() error in onQuery: ${err.message}`);

            if (verbose) {
              console.debug(err);
            }
          }
        });
      } catch (e) {
        console.warn(`[filedrop:mDNS] respond() threw in onQuery: ${e.message}`);

        if (verbose) {
          console.debug(e);
        }
      }
    }
  };
}

async function probe(instance, name, maxSuffix = 10) {
  return new Promise((resolve) => {
    const tryProbe = (suffix) => {
      const candidate = suffix === 1 ? name : `${name}-${suffix}`;
      const candidateService = `${candidate}._http._tcp.local`;

      let hasConflict = false;

      const onResponse = (packet) => {
        const answers = [].concat(packet.answers || [], packet.additionals || [], packet.authorities || []);
        if (answers.some(ans => ans.name === candidateService)) {
          hasConflict = true;
        }
      };

      instance.on('response', onResponse);

      try {
        instance.query({
          questions: [{ name: candidateService, type: 'ANY' }]
        });
      } catch (e) {
        instance.removeListener('response', onResponse);
        console.warn(`[filedrop:mDNS] probe query failed for "${candidateService}": ${e.message}`);
        resolve(candidate);
        return;
      }

      setTimeout(() => {
        instance.removeListener('response', onResponse);
        if (hasConflict) {
          if (suffix < maxSuffix) {
            tryProbe(suffix + 1);
          } else {
            console.warn(`[filedrop:mDNS] Warning: Exhausted probing suffixes. Using ${candidateService} despite potential conflict.`);
            resolve(candidate);
          }
        } else {
          resolve(candidate);
        }
      }, 250);
    };

    tryProbe(1);
  });
}

/**
 * Announces the service via mDNS
 * @param {Object} config
 * @returns {Promise<{ name: string, mdnsAvailable: boolean }>}
 */
async function announce(config) {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';

    let instance;
    try {
      instance = mDNS();
    } catch (e) {
      if (config.verbose || !isWin) {
        console.warn(`mDNS unavailable: ${e.message}. Use the QR code or URL directly.`);
      }
      return resolve({ name: '', mdnsAvailable: false });
    }

    let resolved = false;
    let winTimeout = null;

    const handleError = (err) => {
      if (resolved) return;
      resolved = true;
      if (winTimeout) clearTimeout(winTimeout);

      if (instance) {
        try { instance.destroy(); } catch (e) { console.error("[mdns] Failed to destroy instance:", e); }
      }

      if (isWin) {
        if (config.verbose) {
          console.debug(`mDNS registration skipped on Windows (no elevated permissions or conflict detected).`);
        }
      } else {
        console.warn(`mDNS unavailable: ${err.message}. Use the QR code or URL directly.`);
      }

      resolve({ name: '', mdnsAvailable: false });
    };

    instance.on('error', handleError);

    if (isWin) {
      winTimeout = setTimeout(() => {
        handleError(new Error('Windows registration timeout'));
      }, 1000);
    }

    let baseServiceName = config.mdnsName || config.mdnsNameOverride || generateBaseName(config.filename);
    baseServiceName = baseServiceName.replace(/\.local$/, '');

    probe(instance, baseServiceName).then(finalName => {
      if (resolved) return;

      const hostName = os.hostname().replace(/\.local$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'filedrop';
      currentRecords = buildRecords(finalName, hostName, config.ip, config.port, {
        filename: config.filename,
        size: config.size,
        transferId: config.transferId
      });

      activeServiceName = finalName;
      activeHostName = hostName;
      mdnsInstance = instance;

      activeOnQuery = makeOnQuery(config.verbose);
      instance.on('query', activeOnQuery);

      try {
        instance.respond({ answers: currentRecords }, (err) => {
          if (resolved) return;
          if (err) {
            handleError(err);
            return;
          }
          resolved = true;
          if (winTimeout) clearTimeout(winTimeout);
          isRegistered = true;
          resolve({ name: finalName, mdnsAvailable: true });
        });
      } catch (err) {
        handleError(err);
      }
    });
  });
}

async function deregister() {
  if (!mdnsInstance || !isRegistered) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const goodbyeRecords = currentRecords.map(r => ({ ...r, ttl: 0 }));

    try {
      mdnsInstance.respond({ answers: goodbyeRecords }, () => {
        setTimeout(() => {
          try {
            mdnsInstance.removeListener('query', activeOnQuery);
            activeOnQuery = null;
            mdnsInstance.destroy();
          } catch (e) { console.error("[mdns] Failed to remove listener or destroy instance:", e); }
          mdnsInstance = null;
          currentRecords = [];
          isRegistered = false;
          resolve();
        }, 200);
      });
    } catch (e) {
      console.warn("[mdns] deregister: error sending goodbye records:", e);
      resolve();
    }
  });
}

module.exports = {
  announce,
  deregister
};
