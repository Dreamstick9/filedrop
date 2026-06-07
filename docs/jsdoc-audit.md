# JSDoc Audit

The following is an audit of JSDoc completeness across the codebase. Due to the high number of missing JSDoc comments across the project, the following JSDoc headers should be applied to exported functions in the source files.

## src/server.js
```javascript
/**
 * Initializes and starts the ephemeral HTTP server for filedrop.
 *
 * @param {Object} params 
 * @param {string} params.filePath - Absolute path to the file.
 * @param {number} params.port - The port to bind to.
 * @param {Object} [params.options={}] - Server options (e.g. timeout, version, onShutdown).
 * @param {Function} params.onTransferComplete - Callback when transfer completes successfully.
 * @param {Function} params.onTransferError - Callback when a fatal error occurs.
 * @returns {Promise<{ server: http.Server, shutdown: () => Promise<void> }>}
 * @throws {Error} Throws if the file cannot be stat'd.
 * @example
 * const { server, shutdown } = await createServer({
 *   filePath: '/tmp/photo.jpg',
 *   port: 8080,
 *   onTransferComplete: () => console.log('Done'),
 *   onTransferError: (err) => console.error(err)
 * });
 */
```

## src/network.js
```javascript
/**
 * Determines the filter reason for a network interface.
 *
 * @param {string} name - The name of the network interface.
 * @param {Object} info - The network interface info object from os.networkInterfaces().
 * @returns {string|null} The reason the interface is filtered, or null if usable.
 * @throws {TypeError} Throws if info is undefined or missing properties.
 * @example
 * const reason = getFilterReason('lo0', { family: 'IPv4', internal: true, address: '127.0.0.1' });
 * // returns 'loopback'
 */

/**
 * Scores a network interface to determine the best default choice.
 *
 * @param {string} name - The name of the network interface.
 * @param {Object} info - The network interface info object.
 * @returns {number} The computed score (higher is better).
 * @throws {TypeError} Throws if info is undefined or missing properties.
 * @example
 * const score = scoreInterface('en0', { address: '192.168.1.10' });
 */

/**
 * Validates whether a string is a valid IPv4 address.
 *
 * @param {string} ip - The IP address string to validate.
 * @returns {boolean} True if valid IPv4, false otherwise.
 * @throws {Error} Does not throw.
 * @example
 * const isValid = isValidIPv4('192.168.1.1'); // true
 */

/**
 * Retrieves the best available IPv4 network interface, or the one specified by bind.
 *
 * @param {Object} [options={}] - Options including bind IP and verbosity.
 * @param {string} [options.bind] - IP address to explicitly bind to.
 * @param {boolean} [options.verbose] - Whether to log interface choices.
 * @returns {Object} The selected network interface object { name, info }.
 * @throws {Error} Exits the process if no valid interfaces are found or if the bind IP is invalid.
 * @example
 * const iface = getInterface({ verbose: true });
 */
```

## src/platform.js
```javascript
/**
 * Checks if the current platform is Windows.
 *
 * @returns {boolean} True if running on Windows.
 * @throws {Error} Does not throw.
 * @example
 * if (isWindows()) { // handle Windows quirks }
 */

/**
 * Checks if the current platform is macOS.
 *
 * @returns {boolean} True if running on macOS.
 * @throws {Error} Does not throw.
 * @example
 * if (isMac()) { // handle macOS quirks }
 */

/**
 * Checks if the current platform is Linux.
 *
 * @returns {boolean} True if running on Linux.
 * @throws {Error} Does not throw.
 * @example
 * if (isLinux()) { // handle Linux quirks }
 */

/**
 * Checks if the current process is running in an interactive TTY.
 *
 * @returns {boolean} True if stdout is a TTY.
 * @throws {Error} Does not throw.
 * @example
 * if (!isInteractiveTTY()) { console.log('Running in background or piped'); }
 */

/**
 * Checks if the current terminal supports ANSI color codes.
 *
 * @returns {boolean} True if ANSI colors are supported.
 * @throws {Error} Does not throw.
 * @example
 * const colorSupported = supportsAnsi();
 */

/**
 * Checks if the current terminal supports Unicode block characters.
 *
 * @returns {boolean} True if Unicode block characters are supported safely.
 * @throws {Error} Does not throw.
 * @example
 * const unicodeSupported = supportsUnicode();
 */
```

## src/safe-run.js
```javascript
/**
 * Safely runs an asynchronous function, catching and logging any errors without throwing.
 *
 * @param {Function} fn - The async function to run.
 * @param {string} label - A label for the operation (used in error logging).
 * @returns {Promise<void>} Resolves when the function completes or fails.
 * @throws {Error} Does not throw.
 * @example
 * await safeRun(async () => { await server.shutdown(); }, 'server shutdown');
 */
```
