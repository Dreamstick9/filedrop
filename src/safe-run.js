/**
 * src/safe-run.js
 * Utility for running cleanup functions safely without throwing exceptions.
 */

/**
 * Runs an asynchronous function safely. If it throws, logs a warning
 * to stderr instead of letting the exception bubble up.
 * 
 * @param {Function} fn - Async function to run.
 * @param {string} label - A description of the operation for logging purposes.
 * @returns {Promise<void>}
 */
async function safeRun(fn, label) {
  try {
    await fn();
  } catch (err) {
    console.error(`Warning: error during ${label}: ${err.message}`);
    if (process.env.FILEDROP_DEBUG) {
      console.error(err.stack);
    }
  }
}

module.exports = { safeRun };
