const minimist = require('minimist');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pkg = require("../package.json");
const VERSION = pkg.version;
const repositoryUrl =
  typeof pkg.repository === 'string'
    ? pkg.repository
    : pkg.repository?.url || '';

const REPOSITORY_URL = repositoryUrl
  .replace(/^git\+/, '')
  .replace(/\.git$/, '');

const {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_ICE_TIMEOUT_SECONDS
} = require('./constants');
const { MIN_PORT, MAX_PORT } = require('./port');

function printHelp() {
  console.log(`filedrop — instant local file & folder transfer via QR code

Usage:
  filedrop <file-or-dir> [file2 ...] [options]

Examples:
  filedrop ./photo.jpg
  filedrop ./report.pdf --port 9000 --verbose
  filedrop ./photo1.jpg ./photo2.jpg ./photo3.jpg  # serve multiple files as .zip
  filedrop ./my-folder                             # serve a directory as .zip

Options:
  -p, --port <n>         Specific port to bind (default: auto 8000-8999)
  -b, --bind <ip>        Network interface IP to use (default: auto-detect)
  -t, --timeout <s>      Seconds to wait for a connection (default: ${DEFAULT_TIMEOUT_SECONDS})
  --token [token]        Require a token parameter (?t=<token>) to access links. If no value is provided, a random 16-character hex token will be generated.
  --max-connections <n>  Max concurrent TCP connections (default: ${DEFAULT_MAX_CONNECTIONS}, 0 to disable)
  --no-warn-sensitive    Suppress warning prompt before serving sensitive files
  --shutdown-grace-ms <ms>
                         Milliseconds to wait for transfer completion before
                         force-exiting on SIGINT/SIGTERM (default: ${DEFAULT_SHUTDOWN_GRACE_MS})
  --rate-limit-window <ms>
                         Rate limit window in milliseconds (default: ${DEFAULT_RATE_LIMIT_WINDOW_MS})
  --rate-limit-max <n>   Max requests per IP per window (default: ${DEFAULT_RATE_LIMIT_MAX})
  -n, --name <name>      Override mDNS service name
  --qr / --no-qr         Show or hide the QR code (default: show)
  --qr-compact           Print QR code without surrounding metadata box
  --no-mdns              Disable mDNS broadcasting
  --mesh / --no-mesh     Enable or disable WebRTC mesh transport (default: auto)
  --signal-url <url>     Signaling server URL for WebRTC mesh fallback
  --no-relay             Disable relay fallback for symmetric NAT
  --relay-password <sec> Required shared secret before the relay accepts frames
  --ice-timeout <s>      Seconds to wait for ICE connection before relay fallback (default: ${DEFAULT_ICE_TIMEOUT_SECONDS})
  --clipboard            Share system clipboard contents
  --verbose, -v          Verbose output (log all decisions)
  --no-color             Force no-color output (also respects NO_COLOR env var)
  --version              Print version and exit
  --help, -h             Print help and exit
  --download-limit <n>   Number of allowed downloads before closing (default: 1 in non-interactive mode)
  --mesh                 Enable mesh (cross-network) mode; shows a 6-char room code  
  --signal-host <url>    Signaling server base URL (default: https://signal.filedrop.local)  

filedrop v${VERSION} — ${REPOSITORY_URL}`);
}

function parseArgs(argv) {
  const args = minimist(argv.slice(2), {
    boolean: ['qr-compact', 'verbose', 'version', 'help', 'qr', 'mdns', 'clipboard', 'warn-sensitive', 'relay'],
    string: ['port', 'bind', 'timeout', 'rate-limit-window', 'rate-limit-max', 'name', 'color', 'shutdown-grace-ms', 'token', 'max-connections', 'signal-url', 'signal-host', 'relay-password', 'ice-timeout', 'download-limit'],
    alias: {
      p: "port",
      b: "bind",
      t: "timeout",
      n: "name",
      v: "verbose",
      h: "help",
    },
    default: {
      qr: true,
      mdns: true,
      color: true,
      relay: true,
      'warn-sensitive': true,
      timeout: String(DEFAULT_TIMEOUT_SECONDS),
      'ice-timeout': String(DEFAULT_ICE_TIMEOUT_SECONDS),
      'rate-limit-window': String(DEFAULT_RATE_LIMIT_WINDOW_MS),
      'rate-limit-max': String(DEFAULT_RATE_LIMIT_MAX),
      'shutdown-grace-ms': String(DEFAULT_SHUTDOWN_GRACE_MS),
      'max-connections': String(DEFAULT_MAX_CONNECTIONS)
    }
  });

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`filedrop ${VERSION}`);
    process.exit(0);
  }

  let filePath = null;
  let filePaths = [];
  let isMultiFile = false;
  let isDirectory = false;
  let fileSize = null;

  if (args.clipboard) {
    if (args._.length !== 0) {
      console.error(
        "filedrop: error: Cannot provide a file path when sharing clipboard",
      );
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  } else {
    if (args._.length === 0) {
      console.error(
        "filedrop: error: at least one file or directory must be provided (or use --clipboard)",
      );
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }

    filePaths = args._.map((p) => path.resolve(p));

    const statCache = new Map();

    for (const p of filePaths) {
      if (!fs.existsSync(p)) {
        console.error(`filedrop: error: File not found at path: ${p}`);
        console.error("Run 'filedrop --help' for usage.");
        process.exit(4);
      }

      const stat = fs.statSync(p);
      statCache.set(p, stat);
      if (!stat.isFile() && !stat.isDirectory()) {
        console.error(`filedrop: error: Path is not a file or directory: ${p}`);
        console.error("Run 'filedrop --help' for usage.");
        process.exit(4);
      }

      try {
        fs.accessSync(p, fs.constants.R_OK);
      } catch (err) {
        console.error(`filedrop: error: Permission denied reading file: ${p}`);
        console.error("Run 'filedrop --help' for usage.");
        process.exit(4);
      }
    }

    filePath = filePaths[0];
    isMultiFile = filePaths.length > 1;
    const firstStat = statCache.get(filePath);
    isDirectory = isMultiFile || firstStat.isDirectory();
    fileSize = isDirectory ? null : firstStat.size;
  }

  let port = null;
  if (args.port !== undefined) {
    port = parseInt(args.port, 10);
    if (isNaN(port) || port < MIN_PORT || port > MAX_PORT) {
      console.error(`filedrop: error: --port must be a valid integer between ${MIN_PORT} and ${MAX_PORT}`);
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  if (args.bind) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(args.bind)) {
      console.error("filedrop: error: --bind must be a valid IPv4 address");
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
    const octets = args.bind.split(".");
    if (octets.some((o) => parseInt(o, 10) > 255)) {
      console.error(
        "filedrop: error: --bind must be a valid IPv4 address (octets <= 255)",
      );
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  let downloadLimit = undefined;
  if (args['download-limit'] !== undefined) {
    const downloadLimitRaw = args['download-limit'];
    downloadLimit = Number(downloadLimitRaw);
    if (!/^\d+$/.test(downloadLimitRaw) || !Number.isSafeInteger(downloadLimit) || downloadLimit <= 0) {
      console.error("filedrop: error: --download-limit must be a positive integer");
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  let timeout = parseInt(args.timeout, 10);
  if (isNaN(timeout) || timeout <= 0) {
    console.error("filedrop: error: --timeout must be a positive integer");
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const shutdownGraceMsRaw = args['shutdown-grace-ms'];
  if (!/^\d+$/.test(shutdownGraceMsRaw)) {
    console.error('filedrop: error: --shutdown-grace-ms must be a positive integer');
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const shutdownGraceMs = Number(shutdownGraceMsRaw);
  const MAX_TIMEOUT_MS = 2_147_483_647; // setTimeout() maximum delay (2^31 - 1)
  if (!Number.isSafeInteger(shutdownGraceMs) || shutdownGraceMs <= 0 || shutdownGraceMs > MAX_TIMEOUT_MS) {
    console.error(`filedrop: error: --shutdown-grace-ms must be a positive integer <= ${MAX_TIMEOUT_MS}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const rateLimitWindow = parseInt(args['rate-limit-window'], 10);
  if (isNaN(rateLimitWindow) || rateLimitWindow <= 0) {
    console.error(
      "filedrop: error: --rate-limit-window must be a positive integer",
    );
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const rateLimitMax = parseInt(args["rate-limit-max"], 10);
  if (isNaN(rateLimitMax) || rateLimitMax <= 0) {
    console.error(
      "filedrop: error: --rate-limit-max must be a positive integer",
    );
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const maxConnections = parseInt(args['max-connections'], 10);
  if (isNaN(maxConnections) || maxConnections < 0) {
    console.error('filedrop: error: --max-connections must be a non-negative integer (0 to disable)');
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  if (args.mesh && !args['signal-url']) {
    console.error('filedrop: error: --signal-url is required when using --mesh');
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  let iceTimeout = parseInt(args['ice-timeout'], 10);
  if (isNaN(iceTimeout) || iceTimeout <= 0) {
    console.error("filedrop: error: --ice-timeout must be a positive integer");
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  let token = null;
  if (args.token !== undefined) {
    if (args.token === '') {
      token = crypto.randomBytes(8).toString('hex');
    } else {
      token = args.token;
    }
  }

  return {
    filePath,
    filePaths,
    isMultiFile,
    fileSize,
    isDirectory,
    isClipboard: args.clipboard,
    port,
    bind: args.bind,
    timeout,
    shutdownGraceMs,
    rateLimitWindow,
    rateLimitMax,
    maxConnections,
    token,
    warnSensitive: args['warn-sensitive'],
    name: args.name,
    qr: args.qr,
    qrCompact: args["qr-compact"],
    mdns: args.mdns,
    verbose: args.verbose,
    color: args.color,
    mesh: args.mesh,
    signalUrl: args['signal-url'],
    signalHost: args["signal-host"] || null,
    downloadLimit,
    relay: args.relay,
    relayPassword: args['relay-password'] || null,
    iceTimeout,
  };
}

module.exports = { parseArgs };
