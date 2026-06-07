# filedrop

Instantly host a file on a local web server with QR code for mobile transfer.

![npm version](https://img.shields.io/npm/v/filedrop) ![CI status](https://img.shields.io/github/actions/workflow/status/org/filedrop/test.yml) ![License](https://img.shields.io/npm/l/filedrop)

Run filedrop, scan with your phone, done.

[Insert demo.gif here]

## Install

```sh
# npm (recommended)
npm install -g filedrop

# npx (no install)
npx filedrop ./photo.jpg

# Homebrew (macOS)
brew install filedrop
```

## Usage

```sh
filedrop ./photo.jpg         # serve an image
filedrop ./report.pdf        # serve a document
filedrop ./video.mp4 -v      # serve with verbose output
```

## How it works

- **Server**: Binds to a local port and serves the exact file specified.
- **mDNS**: Broadcasts a local network name (e.g. `photo-filedrop.local`).
- **QR**: Renders a high-contrast terminal QR code for instantaneous scanning.
- **Auto-terminate**: Automatically shuts down and exits after a single successful transfer.

## Options

| Option | Description |
| --- | --- |
| `-p, --port <n>` | Specific port to bind (default: auto 8000-8999) |
| `-b, --bind <ip>` | Network interface IP to use (default: auto-detect) |
| `-t, --timeout <s>` | Seconds to wait for a connection (default: 300) |
| `-n, --name <name>` | Override mDNS service name |
| `--no-qr` | Suppress QR code, print URL only |
| `--qr-compact` | Print QR code without surrounding metadata box |
| `--no-mdns` | Disable mDNS broadcasting |
| `--verbose, -v` | Verbose output (log all decisions) |
| `--no-color` | Force no-color output (also respects NO_COLOR env var) |
| `--version` | Print version and exit |
| `--help, -h` | Print help and exit |

## Platform support

macOS ✅ | Linux ✅ | Windows ⚠️ (ANSI codes require Windows Terminal)

## FAQ

**My phone can't connect**
Make sure both your computer and phone are on the exact same Wi-Fi network and subnet. If you have an active VPN, try disabling it or use `--bind` to select the correct network interface.

**The QR code looks garbled**
Terminal line height and width can affect the rendering of block characters. Make sure you use a modern terminal, or adjust your font settings.

**mDNS isn't working**
mDNS broadcasting can be filtered by some routers and is not universally supported in all environments. The IP-based QR code always works as a reliable fallback.

**Can I serve a directory?**
No, `filedrop` is strictly for transferring single files. If you need to transfer a directory, create a zip archive first.

**Is this secure?**
For local network operations, yes. It closes immediately after the first transfer, but it does serve files over unencrypted HTTP. See [security.md](docs/security.md) for more info on the threat model.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT
