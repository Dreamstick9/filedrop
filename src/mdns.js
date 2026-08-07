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
const EventEmitter = require('events');

let peerFound = false;

function createSession() {
  return {
    mdnsInstance: null,
    currentRecords: [],
    isRegistered: false,
    activeServiceName: '',
    activeHostName: '',
    activeOnQuery: null,
    activeAnnounce: null
  };
}

let session = createSession();

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

function makeOnQuery(sessionObj, verbose) {
  return (packet) => {
    if (!sessionObj.mdnsInstance || sessionObj.currentRecords.length === 0) return;

    const needsResponse = packet.questions && packet.questions.some(q => {
      return q.name === `_http._tcp.local` ||
        q.name === `${sessionObj.activeServiceName}._http._tcp.local` ||
        q.name === `${sessionObj.activeHostName}.local`;
    });

    if (!needsResponse) return;

    try {
      sessionObj.mdnsInstance.respond({ answers: sessionObj.currentRecords }, (err) => {
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
  };
}

function resetSession() {
  session.mdnsInstance = null;
  session.currentRecords = [];
  session.isRegistered = false;
  session.activeServiceName = '';
  session.activeHostName = '';
  session.activeOnQuery = null;
  peerFound = false;
}

function abortActiveAnnounce() {
  if (session.activeAnnounce && !session.activeAnnounce.settled) {
    session.activeAnnounce.settled = true;
    session.activeAnnounce.resolve({ name: '', mdnsAvailable: false });
  }
  session.activeAnnounce = null;
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

        const hasAnyPeer = answers.some(ans => {
          const serviceName = ans.type === 'PTR' ? ans.data : ans.name;
          return typeof serviceName === 'string' &&
            serviceName.endsWith('-filedrop._http._tcp.local');
        });

        if (hasAnyPeer) {
          peerFound = true;
          module.exports.emit('peer-found', packet);
        }
      };

      instance.on('response', onResponse);

      try {
        instance.query({
          questions: [
            { name: candidateService, type: 'ANY' },
            { name: '_http._tcp.local', type: 'PTR' }
          ]
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
  peerFound = false;
  if (session.mdnsInstance) {
    abortActiveAnnounce();
    await deregister();
  }

  return new Promise((resolve) => {
    const announceHandle = { settled: false, resolve };
    session.activeAnnounce = announceHandle;

    const finish = (result) => {
      if (announceHandle.settled) return;
      announceHandle.settled = true;
      if (session.activeAnnounce === announceHandle) {
        session.activeAnnounce = null;
      }
      resolve(result);
    };

    const isWin = os.platform() === 'win32';
    let instance;

    try {
      instance = mDNS();
    } catch (e) {
      if (config.verbose || !isWin) {
        console.warn(`mDNS unavailable: ${e.message}. Use the QR code or URL directly.`);
      }
      finish({ name: '', mdnsAvailable: false });
      return;
    }

    session.mdnsInstance = instance;

    let winTimeout = null;

    const handleError = (err) => {
      if (announceHandle.settled) return;
      if (winTimeout) clearTimeout(winTimeout);

      if (instance) {
        try { instance.destroy(); } catch (e) { console.error("[mdns] Failed to destroy instance:", e); }
      }

      resetSession();
      finish({ name: '', mdnsAvailable: false });

      if (isWin) {
        if (config.verbose) {
          console.debug(`mDNS registration skipped on Windows (no elevated permissions or conflict detected).`);
        }
      } else {
        console.warn(`mDNS unavailable: ${err.message}. Use the QR code or URL directly.`);
      }
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
      if (announceHandle.settled || session.activeAnnounce !== announceHandle || session.mdnsInstance !== instance) {
        finish({ name: '', mdnsAvailable: false });
        return;
      }

      const hostName = os.hostname().replace(/\.local$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'filedrop';
      session.currentRecords = buildRecords(finalName, hostName, config.ip, config.port, {
        filename: config.filename,
        size: config.size,
        transferId: config.transferId
      });

      session.activeServiceName = finalName;
      session.activeHostName = hostName;
      session.activeOnQuery = makeOnQuery(session, config.verbose);
      session.mdnsInstance.on('query', session.activeOnQuery);

      session.activeOnResponse = (packet) => {
        const answers = [].concat(packet.answers || [], packet.additionals || [], packet.authorities || []);
        const hasAnyPeer = answers.some(ans => {
          const serviceName = ans.type === 'PTR' ? ans.data : ans.name;
          return typeof serviceName === 'string' && serviceName.endsWith('-filedrop._http._tcp.local');
        });
        if (hasAnyPeer) {
          peerFound = true;
          module.exports.emit('peer-found', packet);
        }
      };
      session.mdnsInstance.on('response', session.activeOnResponse);

      try {
        session.mdnsInstance.respond({ answers: session.currentRecords }, (err) => {
          if (announceHandle.settled) return;
          if (winTimeout) clearTimeout(winTimeout);
          if (err) {
            handleError(err);
            return;
          }
          session.isRegistered = true;
          finish({ name: finalName, mdnsAvailable: true });
        });
      } catch (err) {
        handleError(err);
      }
    }).catch((err) => {
      if (!announceHandle.settled) {
        handleError(err);
      }
    });
  });
}

async function deregister() {
  abortActiveAnnounce();

  if (!session.mdnsInstance) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finishDeregister = () => {
      if (resolved) return;
      resolved = true;
      try {
        if (session.activeOnQuery && session.mdnsInstance) {
          session.mdnsInstance.removeListener('query', session.activeOnQuery);
          session.activeOnQuery = null;
        }
        if (session.activeOnResponse && session.mdnsInstance) {
          session.mdnsInstance.removeListener('response', session.activeOnResponse);
          session.activeOnResponse = null;
        }
        if (session.mdnsInstance) {
          session.mdnsInstance.destroy();
        }
      } catch (e) { console.error("[mdns] Failed to remove listener or destroy instance:", e); }
      resetSession();
      resolve();
    };

    const safetyTimer = setTimeout(finishDeregister, 300);
    const goodbyeRecords = (session.currentRecords || []).map(r => ({ ...r, ttl: 0 }));

    try {
      session.mdnsInstance.respond({ answers: goodbyeRecords }, () => {
        clearTimeout(safetyTimer);
        setTimeout(finishDeregister, 100);
      });
    } catch (e) {
      console.warn("[mdns] deregister: error sending goodbye records:", e);
      clearTimeout(safetyTimer);
      finishDeregister();
    }
  });
}

function bind(lifecycle) {
  module.exports.on('peer-found', (packet) => {
    lifecycle.emit('mdns:peer-found', packet);
  });

  lifecycle.on('mdns:announce', async (config) => {
    try {
      const result = await module.exports.announce(config);
      lifecycle.emit('mdns:announced', result);
    } catch (err) {
      lifecycle.emit('mdns:error', err);
    }
  });

  lifecycle.on('mdns:deregister', async () => {
    try {
      await module.exports.deregister();
      lifecycle.emit('mdns:deregistered');
    } catch (err) {
      lifecycle.emit('mdns:error', err);
    }
  });

  lifecycle.on('shutdown', (cleanups) => {
    cleanups.push(module.exports.deregister());
  });
}

module.exports = {
  announce,
  deregister,
  teardown: deregister,
  bind,
  hasPeerFound: () => peerFound,
  resetPeerFound: () => { peerFound = false; }
};
Object.setPrototypeOf(module.exports, EventEmitter.prototype);
EventEmitter.call(module.exports);
