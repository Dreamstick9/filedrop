#!/usr/bin/env node

/**
 * filedrop - CLI Entry Point
 */

// Validate Node.js version before loading any modules
const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split('.')[0], 10);

if (majorVersion < 18) {
  console.error(`\x1b[31mfiledrop: error: Node.js version 18 or higher is required.\x1b[0m`);
  console.error(`You are currently running Node.js ${nodeVersion}.`);
  console.error('Please upgrade Node.js to use this tool.');
  process.exit(1);
}

// Ensure the process fails on unhandled rejections instead of silently ignoring them
process.on('unhandledRejection', (err) => {
  console.error('\x1b[31mfiledrop: fatal error: Unhandled Promise Rejection\x1b[0m');
  console.error(err);
  process.exit(1);
});

// Load and execute the main orchestrator
require('../src/index.js');
