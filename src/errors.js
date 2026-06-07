/**
 * src/errors.js
 * Defines the error class hierarchy and error code constants for filedrop.
 */

class FiledropError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.name = 'FiledropError';
  }
}

class FileError extends FiledropError {
  constructor(code, message) {
    super(code, message, 4);
    this.name = 'FileError';
  }
}

class NetworkError extends FiledropError {
  constructor(code, message, exitCode = 2) {
    super(code, message, exitCode);
    this.name = 'NetworkError';
  }
}

class TransferError extends FiledropError {
  constructor(code, message, exitCode = 5) {
    super(code, message, exitCode);
    this.name = 'TransferError';
  }
}

class ConfigError extends FiledropError {
  constructor(code, message) {
    super(code, message, 1);
    this.name = 'ConfigError';
  }
}

const ERROR_CODES = {
  // File Errors
  ERR_FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
  ERR_FILE_IS_DIR: 'ERR_FILE_IS_DIR',
  ERR_FILE_UNREADABLE: 'ERR_FILE_UNREADABLE',

  // Network Errors
  ERR_NO_INTERFACE: 'ERR_NO_INTERFACE',
  ERR_PORT_EXHAUSTED: 'ERR_PORT_EXHAUSTED',
  ERR_BIND_FAILED: 'ERR_BIND_FAILED',

  // Transfer Errors
  ERR_TRANSFER_TIMEOUT: 'ERR_TRANSFER_TIMEOUT',
  ERR_CLIENT_DISCONNECTED: 'ERR_CLIENT_DISCONNECTED',
  ERR_TOO_MANY_OPEN_FILES: 'ERR_TOO_MANY_OPEN_FILES',

  // Config Errors
  ERR_INVALID_ARGUMENT: 'ERR_INVALID_ARGUMENT',
  ERR_INVALID_PORT: 'ERR_INVALID_PORT',
  ERR_INVALID_IP: 'ERR_INVALID_IP'
};

/**
 * Registers global process error handlers.
 * To be called early in the lifecycle.
 */
function registerGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    // Clear any in-progress terminal state (restore cursor, etc.)
    console.error(`\nfiledrop: unexpected error: ${err.message}`);
    if (process.env.FILEDROP_DEBUG) {
      console.error(err.stack);
    }
    process.exit(99);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`\nfiledrop: unhandled async error: ${reason}`);
    if (process.env.FILEDROP_DEBUG) {
      console.error(reason?.stack || reason);
    }
    process.exit(99);
  });
}

module.exports = {
  FiledropError,
  FileError,
  NetworkError,
  TransferError,
  ConfigError,
  ERROR_CODES,
  registerGlobalErrorHandlers
};
