# @dreamstick/filedrop

Instantly host a file on a local web server with QR code for mobile transfer.

![npm version](https://img.shields.io/npm/v/@dreamstick/filedrop) ![CI status](https://img.shields.io/github/actions/workflow/status/Dreamstick9/filedrop/test.yml) ![License](https://img.shields.io/npm/l/@dreamstick/filedrop)

Run filedrop, scan with your phone, done.

[Insert demo.gif here]

## Install

```sh
# npm (recommended)
npm install -g @dreamstick/filedrop

# npx (no install)
npx @dreamstick/filedrop ./photo.jpg
```

## Usage

**Interactive Mode (New!)**
Simply run `filedrop` with no arguments to launch the butter-smooth Interactive Terminal Wizard. It will guide you through file selection, send/receive modes, limits, and PIN setup.

```sh
filedrop
```

**Manual CLI Mode**
You can still use flags for quick one-off commands:
```sh
filedrop ./photo.jpg         # serve an image
filedrop ./report.pdf        # serve a document
filedrop ./photos-folder     # stream directory as a ZIP file
filedrop --receive ./dl      # receive files to the ./dl directory
filedrop ./video.mp4 --limit 5  # allow up to 5 downloads
filedrop ./video.mp4 --pin 1234 # use a custom PIN
```

## How it works

- **Server**: Binds to a local port and serves the file or directory.
- **PIN Authentication**: Every transfer is protected by a 4-digit PIN (auto-generated or custom via `--pin`) to ensure network security.
- **QR**: Renders a high-contrast terminal QR code for instantaneous scanning.
- **Receive Mode**: Turns your device into an upload portal to receive files securely.
- **Directory Streaming**: Directories are automatically archived into `.zip` files and streamed on the fly.
- **Auto-terminate**: Automatically shuts down and exits after the transfer limit is reached (default: 1 successful transfer).

## Options

| Option | Description |
| --- | --- |
| `-p, --port <n>` | Specific port to bind (default: auto 8000-8999) |
| `-t, --timeout <s>` | Seconds to wait for a connection (default: 300) |
| `--receive` | Receive files instead of sending (defaults to current dir) |
| `--limit <n>` | Maximum number of successful transfers (default: 1) |
| `--pin <pin>` | Set a custom 4-digit PIN (default: auto-generated) |
| `--no-qr` | Suppress QR code, print URL only |
| `--qr-compact` | Print QR code without surrounding metadata box |
| `--verbose, -v` | Verbose output (log all decisions) |
| `--version` | Print version and exit |
| `--help, -h` | Print help and exit |

## Platform support

macOS ✅ | Linux ✅ | Windows ⚠️ (ANSI codes require Windows Terminal)

## FAQ

**My phone can't connect**
Make sure both your computer and phone are on the exact same Wi-Fi network and subnet. If you have an active VPN, try disabling it.

**The QR code looks garbled**
Terminal line height and width can affect the rendering of block characters. Make sure you use a modern terminal, or adjust your font settings.

**Can I serve a directory?**
Yes! `filedrop` now automatically creates a `.zip` archive on the fly and streams it to the downloading device without using extra disk space.

**Is this secure?**
For local network operations, yes. It closes immediately after the transfer limit is reached, and requires a 4-digit PIN to download or upload files. See [security.md](docs/security.md) for more info on the threat model.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT
