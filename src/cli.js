const minimist = require('minimist');
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';

function printHelp() {
  console.log(`filedrop — instant local file transfer via QR code

Usage:
  filedrop [path] [options]

Examples:
  filedrop ./photo.jpg
  filedrop ./report.pdf --port 9000 --verbose
  filedrop ./video.mp4 --no-qr
  filedrop --receive ./downloads
  filedrop ./photos-folder --limit 5

Options:
  -p, --port <n>         Specific port to bind (default: auto 8000-8999)
  -b, --bind <ip>        Network interface IP to use (default: auto-detect)
  -t, --timeout <s>      Seconds to wait for a connection (default: 300)
  -n, --name <name>      Override mDNS service name
  --receive              Receive files instead of sending (defaults to current dir)
  --limit <n>            Maximum number of successful transfers (default: 1)
  --pin <pin>            Set a custom 4-digit PIN (default: auto-generated)
  --no-qr                Suppress QR code, print URL only
  --qr-compact           Print QR code without surrounding metadata box
  --no-mdns              Disable mDNS broadcasting
  --verbose, -v          Verbose output (log all decisions)
  --no-color             Force no-color output (also respects NO_COLOR env var)
  --version              Print version and exit
  --help, -h             Print help and exit

filedrop v${VERSION} — https://github.com/<org>/filedrop`);
}

async function parseArgs(argv) {
  const args = minimist(argv.slice(2), {
    boolean: ['qr-compact', 'verbose', 'version', 'help', 'qr', 'mdns', 'color', 'receive'],
    string: ['port', 'bind', 'timeout', 'name', 'limit', 'pin'],
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

  let targetPath = args._.length > 0 ? args._[0] : null;

  if (!targetPath && !args.receive && process.stdout.isTTY) {
    const inquirer = require('inquirer');
    console.log('✨ Welcome to filedrop interactive mode!\n');
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'What would you like to do?',
        choices: [
          { name: '📤 Send a file or directory', value: 'send' },
          { name: '📥 Receive files to a directory', value: 'receive' }
        ]
      },
      {
        type: 'input',
        name: 'target',
        message: (ans) => ans.mode === 'send' ? 'Enter the path to send (e.g. ./photo.jpg):' : 'Enter the directory to save received files (leave blank for current directory):',
        validate: (input, ans) => {
          if (ans.mode === 'receive' && !input) return true;
          if (!input) return 'Path cannot be empty';
          const p = path.resolve(input);
          if (!fs.existsSync(p)) return `Path does not exist: ${p}`;
          return true;
        }
      },
      {
        type: 'input',
        name: 'limit',
        message: 'How many successful downloads should be allowed?',
        default: '1',
        when: (ans) => ans.mode === 'send',
        validate: (input) => !isNaN(parseInt(input, 10)) && parseInt(input, 10) > 0 ? true : 'Must be a positive integer'
      },
      {
        type: 'input',
        name: 'pin',
        message: 'Enter a 4-digit PIN (or leave blank to auto-generate):',
        validate: (input) => {
          if (!input) return true;
          return /^\d{4}$/.test(input) ? true : 'PIN must be exactly 4 digits';
        }
      }
    ]);

    if (answers.mode === 'receive') {
      args.receive = true;
    }
    
    if (answers.mode === 'receive' && !answers.target) {
      targetPath = process.cwd();
    } else {
      targetPath = path.resolve(answers.target);
    }
    
    if (answers.limit) args.limit = answers.limit;
    if (answers.pin) args.pin = answers.pin;
    
    console.log(); // Add a newline before the server starts
  } else if (args.receive) {
    targetPath = targetPath ? path.resolve(targetPath) : process.cwd();
  } else {
    if (!targetPath) {
      console.error('filedrop: error: exactly one file/directory must be provided, or use --receive');
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
    targetPath = path.resolve(targetPath);
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`filedrop: error: Path not found: ${targetPath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  const stat = fs.statSync(targetPath);
  const isDir = stat.isDirectory();

  if (args.receive && !isDir) {
    console.error(`filedrop: error: Path must be a directory when using --receive: ${targetPath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  try {
    if (args.receive) {
      fs.accessSync(targetPath, fs.constants.W_OK);
    } else {
      fs.accessSync(targetPath, fs.constants.R_OK);
    }
  } catch (err) {
    console.error(`filedrop: error: Permission denied for path: ${targetPath}`);
    console.error("Run 'filedrop --help' for usage.");
    process.exit(4);
  }

  let limit = 1;
  if (args.limit !== undefined) {
    limit = parseInt(args.limit, 10);
    if (isNaN(limit) || limit < 1) {
      console.error('filedrop: error: --limit must be a positive integer');
      console.error("Run 'filedrop --help' for usage.");
      process.exit(1);
    }
  }

  let pin = args.pin;
  if (!pin) {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } else {
    pin = pin.toString();
    if (!/^\d{4}$/.test(pin)) {
       console.error('filedrop: error: --pin must be exactly 4 digits to match the login form');
       console.error("Run 'filedrop --help' for usage.");
       process.exit(1);
    }
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
    filePath: targetPath,
    fileSize: isDir ? 0 : stat.size,
    isDir,
    receive: args.receive,
    limit,
    pin,
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
