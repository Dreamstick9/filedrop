# filedrop Security & Threat Model

`filedrop` is designed as a secure local-network file transfer tool. It is not internet-facing and does not employ traditional authentication mechanisms because it aims for extreme usability on trusted networks.

However, we understand that "trusted networks" still require precautions.

## Data Transmission
- Files are transmitted over unencrypted HTTP.
- No data leaves your local network unless your IP interface configuration directs traffic over a tunnel/VPN.
- mDNS packets are broadcasted locally to `224.0.0.251:5353`.

## Single-Client Auto-Termination
To prevent accidental or unauthorized multi-client downloads:
- The server responds with `410 Gone` to all subsequent requests after the first GET request is established.
- The process exits cleanly and immediately once the first download completes.
- It will time out (default 300s) if no connection is received.

## Advanced Security Options
- **`--bind <ip>`**: Instead of binding to `0.0.0.0` (all interfaces), you can bind strictly to a specific local interface to reduce exposure.
- **Sensitive File Warning**: By default, `filedrop` checks filenames against heuristics (e.g. `*.pem`, `*.key`, `*.env`) and prompts before serving them. You can bypass this with `--no-warn-sensitive`.
- **`--token` (if implemented)**: Appends a random 8-character token to the URL ensuring only the user who scans the QR code or copies the link can access the file, protecting against shoulder surfers and LAN scanners.

*For more details on the complete threat model and mitigation of path traversals or DOS flooding, check the internal specifications.*
