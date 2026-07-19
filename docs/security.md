# filedrop Security & Threat Model

`filedrop` is designed as a secure local-network file transfer tool. It is not internet-facing and does not employ traditional authentication mechanisms because it aims for extreme usability on trusted networks.

However, we understand that "trusted networks" still require precautions.

## Data Transmission
- Files are transmitted over unencrypted HTTP.
- No data leaves your local network unless your IP interface configuration directs traffic over a tunnel/VPN.
- mDNS packets are broadcasted locally to `224.0.0.251:5353`.

## Multi-User & Auto-Termination
To prevent accidental or unauthorized multi-client downloads:
- The server now prompts for the number of authorized downloaders.
- The server responds with `410 Gone` to all subsequent requests after the authorized number of GET requests are established.
- The process exits cleanly and immediately once the downloads complete.
- It will time out (default 300s) if no connection is received.

## Client-Side Security & UX
- **Key Scrubbing**: Instead of auto-closing the window upon download completion, the client script instantly scrubs the decryption key from the address bar using `window.history.replaceState` the moment the download is triggered. This balances a smooth user experience (allowing interaction with browser save dialogs and security prompts) with robust security against shoulder-surfing.

## Advanced Security Options
- **`--bind <ip>`**: Instead of binding to `0.0.0.0` (all interfaces), you can bind strictly to a specific local interface to reduce exposure.
- **Sensitive File Warning**: By default, `filedrop` checks filenames against heuristics (e.g. `*.pem`, `*.key`, `*.env`, `id_rsa`, `credentials`) and prompts before serving them. You can bypass this warning with `--no-warn-sensitive`.
- **`--token [token]`**: Gates access to the share links using a token parameter (`?t=<token>`). If the option is passed without a value, a random 16-character hex token is generated.
  > [!WARNING]
  > **Token Security Tradeoff**: Because this is a zero-JS-framework flow, the token query parameter is sent in the HTTP request line. This means it will appear in server/proxy logs, browser history, and outbound `Referer` headers.The server sets the `Referrer-Policy: no-referrer` header on the decryptor HTML response to prevent transfer tokens from being leaked via the `Referer` header.
- **`--max-connections <n>`**: Restricts concurrent TCP connections to the server to prevent socket flooding (default: 10, set to 0 to disable).

*For more details on the complete threat model and mitigation of path traversals or DOS flooding, check the internal specifications.*
