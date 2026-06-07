const os = require('os');

/**
 * Platform detection utilities
 */

function isWindows() {
  return process.platform === 'win32';
}

function isMac() {
  return process.platform === 'darwin';
}

function isLinux() {
  return process.platform === 'linux';
}

function isInteractiveTTY() {
  return !!process.stdout.isTTY;
}

function supportsAnsi() {
  if ('NO_COLOR' in process.env) {
    return false;
  }
  if (process.env.TERM === 'dumb') {
    return false;
  }
  if ('FORCE_COLOR' in process.env) {
    return true;
  }
  if (isWindows()) {
    // Windows Terminal and VS Code integrated terminal support ANSI
    return !!process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode' || process.env.TERM === 'xterm-256color';
  }
  return isInteractiveTTY();
}

function supportsUnicode() {
  // macOS and Linux generally support Unicode block characters natively.
  // On Windows, it depends on the terminal and font.
  if (isWindows()) {
    return !!process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode';
  }
  if (process.env.TERM === 'dumb') {
    return false;
  }
  return true;
}

module.exports = {
  isWindows,
  isMac,
  isLinux,
  isInteractiveTTY,
  supportsAnsi,
  supportsUnicode
};
