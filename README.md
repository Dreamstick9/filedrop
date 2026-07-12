# @dreamstick/filedrop (v2.0.8)
<img width="2084" height="340" alt="ascii-art-text (1)" src="https://github.com/user-attachments/assets/2ec139f9-89d5-4238-a83d-69d3709ba7de" />


Instantly host a securely encrypted file on a local web server with a QR code for mobile transfer.

![npm version](https://img.shields.io/npm/v/@dreamstick/filedrop) ![CI status](https://img.shields.io/github/actions/workflow/status/Dreamstick9/filedrop/test.yml) ![License](https://img.shields.io/npm/l/@dreamstick/filedrop)

Run filedrop, scan with your phone, done.

## What's New in v2.0.8?

Filedrop v2.0.8 is a major update with several powerful features and UX improvements:

*   **Multiple Files & Directories:** You can now transfer multiple files at once, or entire directories. They are automatically compressed into a `.zip` stream on the fly and piped through the encryption layer. No temporary zip files are written to your disk.
*   **Cross-device Clipboard:** Securely share your clipboard contents across devices using the new `--clipboard` flag.
*   **Multi-user Downloads:** Need to share with a group? You will now be prompted for the number of authorized downloaders.
*   **Improved Mobile Browser UX:** The browser interface window no longer auto-closes immediately, allowing you to interact with native browser security prompts or save dialogs safely. The client securely scrubs the decryption key from the address bar (`window.history.replaceState`) the moment the download starts.
*   **Fragment Crypto:** Files are dynamically encrypted on your Mac using military-grade **AES-256-GCM** before they ever hit the network. The decryption key is generated locally and injected directly into the QR code's URL fragment (`#key`). Because browsers never send the `#` fragment over the network, anyone sniffing your Wi-Fi (even at a public coffee shop) sees nothing but encrypted binary garbage.
*   **Ephemeral URLs:** The download path is completely randomized per session (e.g., `/download/08da0a41...`). Attackers cannot blindly scrape or guess the file location.
*   **DDoS Protection:** Built-in IP rate limiter automatically blocks connections that send more than 30 requests in 10 seconds, preventing local scripts from crashing your Node process.
*   **Path Traversal Immunity:** The server rigorously ignores URL path manipulations, making it mathematically impossible to access out-of-scope files like `/etc/passwd`.

## Install

```sh
# npm (recommended)
npm install -g @dreamstick/filedrop

# npx (no install)
npx @dreamstick/filedrop ./photo.jpg
```

## Usage

```sh
filedrop ./photo.jpg                # serve an image
filedrop ./report.pdf               # serve a document
filedrop ./video.mp4 -m             # serve and broadcast via mDNS
filedrop ./folder1 ./file2.txt      # serve multiple files/directories (zipped on the fly)
filedrop --clipboard                # share your clipboard contents
```

## How it works

1.  **Server**: Binds to a local port, generates a secure AES key, and begins serving your file.
2.  **QR**: Renders a high-contrast terminal QR code for instantaneous scanning.
3.  **Transfer**: Your phone connects, downloads the encrypted blob, and decrypts it locally in the browser using the key from the URL fragment.
4.  **Auto-terminate**: Automatically shuts down and exits after the authorized number of successful transfers.

## Options

| Option | Description |
| --- | --- |
| `-p, --port <n>` | Specific port to bind (default: auto 8000-8999) |
| `-m, --mdns` | Broadcast the file over the local network via mDNS |
| `-t, --timeout <s>` | Seconds to wait for a connection (default: 300) |
| `--clipboard` | Share clipboard contents instead of a file |
| `--qr / --no-qr` | Show or hide the QR code (default: show) |
| `--qr-compact` | Print QR code without surrounding metadata box |
| `--color <color>` | Override terminal theme color (e.g., cyan, red, green) |
| `--verbose, -v` | Verbose output (log all decisions) |
| `--version` | Print version and exit |
| `--help, -h` | Print help and exit |

## FAQ

**My phone can't connect**
Make sure both your computer and phone are on the exact same Wi-Fi network and subnet. If you have an active VPN, try disabling it. Alternatively, use the `-m` flag to enable mDNS auto-discovery.

**Is this secure on public Wi-Fi?**
Yes! Because of the Fragment Crypto architecture, the file is entirely encrypted using AES-256-GCM. The decryption key is only passed via the QR code and is never transmitted to the server. Even if someone intercepts your traffic on a public network, they cannot read the file.

**What happened to the PIN codes?**
PIN codes have been fully deprecated and removed. The new Fragment Crypto system is mathematically superior and completely invisible to the user, meaning you no longer have to manually type a PIN into your phone.

**Can I serve a directory or multiple files?**
Yes! Starting in v2.0.8, you can pass multiple files or a directory to `filedrop`. It will automatically compress the payload into a `.zip` stream on the fly and pipe it through the AES-256-GCM encryption layer. No temporary zip files are written to your disk.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT
