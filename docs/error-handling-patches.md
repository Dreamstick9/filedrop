# Error Handling Patches

This document outlines the required error handling improvements across the `filedrop` codebase as per AGENT 10's error handling and resilience audit. 

## 1. Global Error Handlers Integration

**File:** `src/index.js` or `src/cli.js` (Entry Point)
**Action:** Register global catchers as the very first operation.
**Code to add:**
```javascript
const { registerGlobalErrorHandlers } = require('./errors');
registerGlobalErrorHandlers();
```

## 2. Server Module (`src/server.js`)

**Action:** Replace native generic `Error` instances with typed `TransferError` and `FileError` instances. Import error classes and constants.

**Modifications:**
1. At the top of the file, add:
```javascript
const { TransferError, FileError, ERROR_CODES } = require('./errors');
```

2. Around line 33 (in `fs.promises.stat` catch block):
```javascript
  } catch (err) {
    const fileError = new FileError(
      ERROR_CODES.ERR_FILE_UNREADABLE, 
      `filedrop: unable to read file: ${filePath}`
    );
    onTransferError(fileError);
    throw fileError;
  }
```

3. Around line 118 (transfer timeout):
```javascript
// Replace: onTransferError(new Error('ERR_TRANSFER_TIMEOUT'));
onTransferError(new TransferError(
  ERROR_CODES.ERR_TRANSFER_TIMEOUT, 
  'Transfer timed out after 60 seconds of inactivity.'
));
```

4. Around line 133 (client disconnect):
```javascript
// Replace: onTransferError(new Error('ERR_CLIENT_DISCONNECTED'));
onTransferError(new TransferError(
  ERROR_CODES.ERR_CLIENT_DISCONNECTED, 
  'Client disconnected mid-transfer.', 
  6
));
```

5. Around line 149 (EMFILE error):
```javascript
// Replace: onTransferError(new Error('ERR_TOO_MANY_OPEN_FILES'));
onTransferError(new TransferError(
  ERROR_CODES.ERR_TOO_MANY_OPEN_FILES, 
  'Too many open files on the server.'
));
```

6. Around line 151 (general stream error):
```javascript
// Replace: onTransferError(err);
onTransferError(new TransferError(
  err.code || 'ERR_STREAM', 
  `Stream error: ${err.message}`
));
```

## 3. Network Module (`src/network.js`)

**Action:** Replace `console.error` followed by `process.exit` with throwing typed errors so that the orchestrator/CLI handles them centrally.

**Modifications:**
1. At the top of the file, add:
```javascript
const { ConfigError, NetworkError, ERROR_CODES } = require('./errors');
```

2. Around line 66 (Invalid IPv4 for `--bind`):
```javascript
// Replace: console.error(...) and process.exit(1);
throw new ConfigError(
  ERROR_CODES.ERR_INVALID_IP, 
  `Invalid IPv4 address provided to --bind: ${bind}`
);
```

3. Around line 70 (Loopback provided to `--bind`):
```javascript
// Replace: console.error(...) and process.exit(1);
throw new ConfigError(
  ERROR_CODES.ERR_INVALID_IP, 
  `Cannot bind to loopback address: ${bind}`
);
```

4. Around line 76 (IP not matched on interface):
```javascript
// Replace: console.error(...) and process.exit(1);
throw new ConfigError(
  ERROR_CODES.ERR_INVALID_IP, 
  `The IP address ${bind} does not exist on any IPv4 interface on this machine.`
);
```

5. Around line 96 (No usable interface found):
```javascript
// Replace: console.error('ERR_NO_INTERFACE...'); process.exit(2);
throw new NetworkError(
  ERROR_CODES.ERR_NO_INTERFACE, 
  'No usable non-loopback network interface found. Are you connected to a local network?'
);
```

## 4. Orchestrator / Lifecycle Cleanup

**File:** `src/lifecycle.js` or `src/index.js` (where `exitCleanly` resides)
**Action:** Import and use the `safeRun` utility to wrap cleanup procedures to prevent exceptions during the shutdown sequence.

**Code to apply:**
```javascript
const { safeRun } = require('./safe-run');

// When shutting down HTTP server
await safeRun(() => server.shutdown(), 'Server Shutdown');

// When deregistering mDNS
await safeRun(() => mdns.deregister(), 'mDNS Deregistration');
```

## 5. Defensive Checks across Modules

- Ensure all user-facing errors are actionable strings without internal stack traces unless `FILEDROP_DEBUG=1` is set.
- Check return values on all synchronous `fs` methods (e.g. `fs.existsSync`, `fs.accessSync`) in `src/cli.js` and wrap them in `try/catch` emitting `FileError` instances on failure instead of allowing raw Node API errors (like `ENOENT`) to reach the user.
