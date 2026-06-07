const minimist = require('minimist');
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';

function printHelp() {
  console.log(`filedrop — instant local file transfer via QR code

Usage:
  filedrop <file> [options]

Examples:
  filedrop ./photo.jpg
  filedrop ./report.pdf --port 9000 --verbose
  filedrop ./video.mp4 --no-qr

Options:
  -p, --port <n>         Specific port to bind (default: auto 8000-8999)
  -b, --bind <ip>        Network interface IP to use (default: auto-detect)
  -t, --timeout <s>      Seconds to wait for a connection (default: 300)
  -n, --name <name>      Override mDNS service name
  --no-qr                Suppress QR code, print URL only
  --qr-compact           Print QR code without surrounding metadata box
  --no-mdns              Disable mDNS broadcasting
  --verbose, -v          Verbose output (log all decisions)
  --no-color             Force no-color output (also respects NO_COLOR env var)
  --version              Print version and exit
  --help, -h             Print help and exit

filedrop v${VERSION} — https://github.com/<org>/filedrop`);
}

function parseArgs(argv) {
  const args = minimist(argv.slice(2), {
    boolean: ['qr-compact', 'verbose', 'version', 'help', 'qr', 'mdns', 'color'],
    string: ['port', 'bind', 'timeout', 'name'],
    alias: {
      p: 'port',
      b: 'bind',
      t: 'timeout',
      n: 'name',
      v: 'verbose',
      h: 'help'
    },
    default: {
      qr: true,
      mdns: true,
      color: true,
      timeout: '300'
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

  if (args._.length !== 1) {
    console.error('filedrop: error: exactly one file must be provided');
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  const filePath = path.resolve(args._[0]);

  if (!fs.existsSync(filePath)) {
    console.error(`filedrop: error: File not found at path: ${filePath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    console.error(`filedrop: error: Path is a directory, not a file: ${filePath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (err) {
    console.error(`filedrop: error: Permission denied reading file: ${filePath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  let port = null;
  if (args.port !== undefined) {
    port = parseInt(args.port, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      console.error('filedrop: error: --port must be a valid integer between 1024 and 65535');
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  if (args.bind) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(args.bind)) {
      console.error('filedrop: error: --bind must be a valid IPv4 address');
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
    const octets = args.bind.split('.');
    if (octets.some(o => parseInt(o, 10) > 255)) {
      console.error('filedrop: error: --bind must be a valid IPv4 address (octets <= 255)');
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  let timeout = parseInt(args.timeout, 10);
  if (isNaN(timeout) || timeout <= 0) {
    console.error('filedrop: error: --timeout must be a positive integer');
    console.error("Run 'filedrop --help' for usage.");
    process.exit(1);
  }

  return {
    filePath,
    fileSize: stat.size,
    port,
    bind: args.bind,
    timeout,
    name: args.name,
    qr: args.qr,
    qrCompact: args['qr-compact'],
    mdns: args.mdns,
    verbose: args.verbose,
    color: args.color
  };
}

module.exports = { parseArgs };
