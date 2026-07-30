const EventEmitter = require('events');

const STATES = {
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  WAITING: 'WAITING',
  TRANSFERRING: 'TRANSFERRING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  EXITED: 'EXITED'
};

const VALID_TRANSITIONS = {
  [STATES.INITIALIZING]: [STATES.READY],
  [STATES.READY]: [STATES.WAITING],
  [STATES.WAITING]: [STATES.TRANSFERRING, STATES.TIMEOUT],
  [STATES.TRANSFERRING]: [STATES.COMPLETE, STATES.FAILED],
  [STATES.COMPLETE]: [STATES.EXITED],
  [STATES.FAILED]: [STATES.EXITED],
  [STATES.TIMEOUT]: [STATES.EXITED],
  [STATES.EXITED]: []
};

class LifecycleManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.state = STATES.INITIALIZING;
    this.connectionTimeoutSeconds = typeof config.timeout === 'number' ? config.timeout : 300;
    const rawTransferTimeout = config.transferTimeout ?? config.transferTimeoutSeconds;
    const parsedTransferTimeout = Number(rawTransferTimeout);
    this.transferTimeoutSeconds = Number.isFinite(parsedTransferTimeout) && parsedTransferTimeout > 0
      ? parsedTransferTimeout
      : 60;
    this.stdoutFlushTimeout = config.stdoutFlushTimeout ?? 500;
    const failsafeInput = Number(config.failsafeExitTimeout);
    this.failsafeExitTimeout = Number.isFinite(failsafeInput) && failsafeInput > 0
      ? failsafeInput
      : 1000;

    this.connectionTimer = null;
    this.transferTimer = null;
    
    this.mdns = config.mdns;
    this.server = config.server;
    this.fileStreams = new Set();
    
    this.exitStarted = false;
    this.currentSocket = null;
    
    this.fileSize = config.fileSize || 0;
    this.startTime = null;
  }

  registerFileStream(stream) {
    if (this.exitStarted) {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
      return;
    }

    this.fileStreams.add(stream);
    stream.on('close', () => {
      this.fileStreams.delete(stream);
    });
  }

  updateTransferProgress(bytesTransferred) {
    if (this.state === STATES.TRANSFERRING) {
      this.emit('transfer-progress', { 
        bytesTransferred, 
        totalBytes: this.fileSize 
      });
    }
  }

  transition(newState, payload = {}) {
    if (!VALID_TRANSITIONS[this.state].includes(newState)) {
      throw new Error(`Invalid state transition: ${this.state} -> ${newState}`);
    }
    
    const oldState = this.state;
    this.state = newState;
    
    this.emit('stateChange', { oldState, newState, payload });
    
    this._handleStateEntry(newState, payload);
  }

  _handleStateEntry(state, payload) {
    switch (state) {
      case STATES.WAITING:
        this.emit('waiting');
        this._startConnectionTimeout();
        break;
        
      case STATES.TRANSFERRING:
        this.startTime = Date.now();
        this.emit('transfer-start', { fileSize: this.fileSize, startTime: this.startTime });
        this._cancelConnectionTimeout();
        if (payload.socket) {
          this.currentSocket = payload.socket;
        }
        this._startTransferTimeout();
        break;
        
      case STATES.COMPLETE:
        this.emit('transfer-complete', { 
          duration: Date.now() - (this.startTime || Date.now()),
          bytesTransferred: payload.bytesTransferred || this.fileSize 
        });
        this._cancelTransferTimeout();
        this.exitCleanly(0);
        break;
        
      case STATES.FAILED:
        this.emit('failed', { error: payload.error || new Error('Transfer failed') });
        this._cancelTransferTimeout();
        this.exitCleanly(payload.exitCode || 1);
        break;
        
      case STATES.TIMEOUT:
        this.emit('timeout');
        this.exitCleanly(payload.exitCode || 5);
        break;
        
      case STATES.EXITED:
        break;
    }
  }

  _startConnectionTimeout() {
    this._cancelConnectionTimeout();
    if (this.connectionTimeoutSeconds > 0) {
      this.connectionTimer = setTimeout(() => {
        this.transition(STATES.TIMEOUT);
      }, this.connectionTimeoutSeconds * 1000);
    }
  }

  _cancelConnectionTimeout() {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  _startTransferTimeout() {
    this._cancelTransferTimeout();
    this.transferTimer = setTimeout(() => {
      if (this.currentSocket && !this.currentSocket.destroyed) {
        this.currentSocket.destroy();
      }
      this.transition(STATES.FAILED, { 
        exitCode: 5, 
        error: new Error(`Transfer timeout exceeded (${this.transferTimeoutSeconds}s). Client too slow or hung.`) 
      }); 
    }, this.transferTimeoutSeconds * 1000);
  }

  _cancelTransferTimeout() {
    if (this.transferTimer) {
      clearTimeout(this.transferTimer);
      this.transferTimer = null;
    }
  }

  async exitCleanly(exitCode = 0) {
    if (this.exitStarted) return;
    this.exitStarted = true;

    // Failsafe exit in case teardown hangs
    setTimeout(() => process.exit(exitCode), this.failsafeExitTimeout).unref();

    // 1. Cancel all active timers
    this._cancelConnectionTimeout();
    this._cancelTransferTimeout();

    // 2. Remove all signal handlers
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    // 3. Emit 'shutdown' event allowing modules to add their cleanup promises
    const cleanups = [];
    this.emit('shutdown', cleanups);

    // Wrap each event-driven cleanup with a 3s timeout
    const eventCleanupPromises = cleanups.map(p =>
      this._withTimeout(p, 3000).catch(err => {
        this.emit('shutdown-error', {
          phase: 'event-cleanup',
          error: err
        });
      })
    );

    // 4. Backwards compatibility with direct calls
    const legacyCleanups = [];
    if (this.mdns && typeof this.mdns.deregister === 'function') {
      legacyCleanups.push(
        this._withTimeout(this.mdns.deregister(), 2000).catch(err => {
          this.emit('shutdown-error', {
            phase: 'mdns.deregister',
            error: err
          });
        })
      );
    }

    if (this.server && typeof this.server.shutdown === 'function') {
      legacyCleanups.push(
        this._withTimeout(this.server.shutdown(), 3000).catch(err => {
          this.emit('shutdown-error', {
            phase: 'server.shutdown',
            error: err
          });
        })
      );
    }

    // Await all cleanups
    const allCleanups = eventCleanupPromises.concat(legacyCleanups);
    if (allCleanups.length > 0) {
      await Promise.all(allCleanups);
    }

    // Snapshot the Set first — destroy() can trigger the 'close' handler
    // synchronously/early in some stream implementations, which deletes
    // from this.fileStreams. Iterating a live Set while it's being mutated
    // can skip entries, so we iterate a static copy instead.
    const streamsToDestroy = Array.from(this.fileStreams);
    for (const stream of streamsToDestroy) {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    }
    this.fileStreams.clear();

    if (this.state !== STATES.EXITED) {
      const oldState = this.state;
      this.state = STATES.EXITED;
      this.emit('stateChange', { oldState, newState: STATES.EXITED });
    }

    // 5. Flush stdout
    if (process.stdout && !process.stdout.destroyed) {
      try {
        await new Promise((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          if (process.stdout.isTTY) {
            process.stdout.write('', done);
          } else {
            process.stdout.end('', done);
          }

          setTimeout(done, this.stdoutFlushTimeout);
        });
      } catch (e) {
        process.stderr.write(`[filedrop] Failed to flush stdout: ${e.message}\n`);
        if (process.env.FILEDROP_DEBUG) {
          process.stderr.write(`${e.stack}\n`);
        }
      }
    }

    // 6. Call process.exit(exitCode)
    process.exit(exitCode);
  }

  _withTimeout(promise, ms) {
    if (!promise || typeof promise.then !== 'function') {
      return Promise.resolve(promise);
    }
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }
}

module.exports = { LifecycleManager, STATES };
