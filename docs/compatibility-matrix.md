# Cross-Platform Compatibility Matrix

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| HTTP Server (Port Binding) | ✅ Full | ✅ Full (Warn below 1024) | ✅ Full |
| Network Interface Discovery | ✅ Full | ✅ Full | ⚠️ Degraded (wmic nic fallback needed) |
| mDNS Registration | ✅ Full | ✅ Full | ⚠️ Degraded (firewall/conflict risk) |
| Terminal Rendering (ANSI/Color) | ✅ Full | ✅ Full | ⚠️ Degraded (Windows Terminal/VSCode req) |
| Terminal Rendering (Unicode) | ✅ Full | ✅ Full | ⚠️ Degraded (Windows Terminal/VSCode req) |
| File Paths | ✅ Full | ✅ Full | ✅ Full |
| Process Exit / Signal Handling | ✅ Full | ✅ Full | ⚠️ Degraded (Unref failsafe needed) |

## Platform-Specific Notes

### Windows
- **Terminal Rendering**: Native `cmd.exe` lacks reliable ANSI and Unicode block character support. The application automatically degrades to ASCII fallback mode unless Windows Terminal (`WT_SESSION`) or VSCode integrated terminal (`TERM_PROGRAM='vscode'`) is detected.
- **mDNS**: The `multicast-dns` package may throw `EACCES` or `ENOTSUP` due to Windows Defender Firewall or conflicts with the native mDNS responder in Windows 10+. Handled by gracefully disabling mDNS upon socket error.
- **Network Interfaces**: `os.networkInterfaces()` often returns GUIDs instead of friendly names (e.g., `Wi-Fi`). If user-friendly names are needed in verbose output, a fallback to `wmic nic` or similar may be required.

### Linux
- **Port Binding**: Ports below 1024 require root privileges. A warning is surfaced if a user attempts to bind to a restricted port.

### macOS
- **Firewall Prompt**: Binding to a port via Node.js may trigger a macOS application firewall prompt ("Do you want the application node to accept incoming network connections?"). We print a warning to inform the user.
