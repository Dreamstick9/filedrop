# Platform-Specific Notes & Patches for Other Modules

This document contains notes and patches for other modules to ensure cross-platform compatibility across macOS, Linux, and Windows.

## `src/cli.js` (Agent 7)
- **Path Handling**: When parsing the `--file` argument, ensure `path.resolve()` is used to convert it to an absolute path, as Windows paths use backslashes (`\`). Do not construct paths using string concatenation.
- **Shebang Line**: Ensure `package.json` specifies `bin` correctly and that `bin/filedrop.js` uses `#!/usr/bin/env node`. For Windows, ensure `.gitattributes` has `bin/filedrop text eol=lf` to prevent CRLF line endings from breaking the shebang in WSL or bash.

## `src/mdns.js` (Agent 3)
- **Windows mDNS Fallback**: The `multicast-dns` library often requires elevated permissions on Windows and may conflict with built-in mDNS services (like Bonjour or Windows 10+ native responder), throwing `EACCES` or `ENOTSUP`.
  - **Patch**: Surround the socket binding or initialization with a `try/catch`. If it throws, gracefully disable mDNS and print a warning: `"mDNS registration skipped on Windows (no elevated permissions or conflict detected)."`.

## `src/lifecycle.js` (Agent 8)
- **Process Exit on Windows**: On Windows, `process.exit()` might not forcefully terminate the process if there are active I/O handles or timers.
  - **Patch**: Ensure `exitCleanly` includes a failsafe timeout that calls `.unref()` so it doesn't hold the event loop open.
  ```javascript
  setTimeout(() => process.exit(exitCode), 1000).unref();
  ```

## `src/port.js` (Agent 6)
- **Linux Restricted Ports**: Ports below 1024 require root privileges on Linux.
  - **Patch**: If `--port` is less than 1024 and `process.platform === 'linux'`, print a warning: `"Ports below 1024 require root on Linux. Use sudo or choose a port above 1024."`
- **macOS Firewall Prompts**:
  - **Patch**: Check `process.platform === 'darwin'`. Print a one-time note if applicable: `"Note: macOS may prompt to allow network connections for Node.js. Click Allow to enable file transfer."`

## `src/network.js` (Agent 5)
- **Already Patched**: `network.js` was patched to use `wmic nic get GUID,NetConnectionID` to resolve GUIDs to friendly interface names (e.g., "Wi-Fi") on Windows in verbose mode.

## `src/qr.js` (Agent 4)
- **Already Patched**: `qr.js` was patched to use `platform.supportsAnsi()` to reliably fallback from Unicode/Color output to ASCII on legacy Windows consoles (`cmd.exe`).
