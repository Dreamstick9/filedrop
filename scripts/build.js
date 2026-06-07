const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Make sure the CLI entry point has executable permissions
// This ensures that anyone installing from git or modifying locally will have it run properly.
console.log('Ensuring bin/filedrop.js is executable...');
try {
  fs.chmodSync(path.join(BIN_DIR, 'filedrop.js'), 0o755);
} catch (err) {
  console.warn('Could not set permissions on bin/filedrop.js. If on Windows, this is expected.');
}

console.log('Building standalone binaries with pkg...');
console.log('Decision: Using "pkg" from Vercel.');
console.log('Justification: pkg is the standard for packaging Node.js apps into standalone executables.');
console.log('It automatically resolves dependencies and bundles them, including native bindings.');
console.log('NOTE: multicast-dns and native fs operations generally work fine in pkg as long as we don\'t rely on __dirname for reading non-JS assets that weren\'t explicitly included in pkg assets.');

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR);
}

// Ensure pkg is installed, or try to run it via npx if it's not locally installed
try {
  // Targets:
  // - node18-macos-arm64 -> filedrop-macos-arm64
  // - node18-macos-x64   -> filedrop-macos-x64
  // - node18-linux-x64   -> filedrop-linux-x64
  // - node18-win-x64     -> filedrop-win32-x64.exe
  
  const pkgCommand = `npx pkg . --targets node18-macos-arm64,node18-macos-x64,node18-linux-x64,node18-win-x64 --out-path dist`;
  
  console.log(`Running: ${pkgCommand}`);
  execSync(pkgCommand, { stdio: 'inherit', cwd: ROOT_DIR });
  
  // Rename output files to match the specified naming convention
  const renameMap = {
    'filedrop-macos-arm64': 'filedrop-macos-arm64',
    'filedrop-macos-x64': 'filedrop-macos-x64',
    'filedrop-linux-x64': 'filedrop-linux-x64',
    'filedrop-win-x64.exe': 'filedrop-win32-x64.exe'
  };

  const files = fs.readdirSync(DIST_DIR);
  for (const file of files) {
    // pkg might output 'filedrop-win.exe', we match based on extension and OS string
    // Given the target strings, pkg usually outputs: <name>-<os>-<arch>
    let newName = renameMap[file];
    
    // In case pkg named it differently based on its internal mappings
    if (file === 'filedrop-win.exe') newName = 'filedrop-win32-x64.exe';
    
    if (newName && file !== newName) {
      fs.renameSync(path.join(DIST_DIR, file), path.join(DIST_DIR, newName));
    }
  }

  console.log('Build complete. Binaries are in the dist/ directory.');
  console.log('IMPORTANT TEST: Run the binaries and test mDNS. The pkg virtual filesystem can sometimes interfere with multicast-dns if it tries to read specific OS files.');
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
