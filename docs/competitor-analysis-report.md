# Competitor Analysis Report: `filedrop` vs. Market Alternatives

## 1. Executive Summary
This report evaluates `filedrop` against prominent file transfer solutions: `qrcp`, `croc`, `magic-wormhole`, and `snapdrop`. While `filedrop` excels in user experience with its interactive terminal wizard (via Enquirer) and local network QR-code sharing, studying the feature sets of its competitors reveals clear pathways for future enhancement and streamlining.

## 2. Competitor Breakdown

### A. qrcp
*   **Overview:** A Go-based command-line tool that, like `filedrop`, transfers files over Wi-Fi by generating a QR code.
*   **Pros:** Supports HTTPS with custom TLS certs, has a persistent "keep-alive" mode for multiple transfers, opens the system browser automatically.
*   **Cons:** Requires manual network/port configuration sometimes; setting up HTTPS is a manual, non-trivial process.

### B. croc
*   **Overview:** A CLI tool that allows any two computers to transfer files securely.
*   **Pros:** Bypasses local network restrictions (works over the internet) via public relay servers; features End-to-End Encryption (E2EE) using PAKE; supports resuming interrupted transfers.
*   **Cons:** Both sender and receiver *must* install the `croc` CLI tool; no QR-code/browser-based receiving option.

### C. magic-wormhole
*   **Overview:** A highly secure CLI protocol using "magic words" to establish E2EE connections.
*   **Pros:** Best-in-class security (PAKE); works across different networks/firewalls.
*   **Cons:** Requires Python environment and CLI installation on both ends; not as "instant" for non-technical users as scanning a QR code with a phone.

### D. Snapdrop (and PairDrop)
*   **Overview:** A browser-based "AirDrop clone" using WebRTC for local file sharing.
*   **Pros:** Zero installation needed; entirely GUI-based; instant discovery if the network supports it.
*   **Cons:** Often fails on strict corporate networks/firewalls; recent forks (PairDrop) have been required to keep the project stable; entirely relies on device discovery (no manual IP fallback).

## 3. Strategic Recommendations for `filedrop`

### What Features Can Be Added
1.  **End-to-End Encryption (E2EE):** Implement an encrypted transfer mode using the Web Crypto API. The terminal encrypts the file before serving, and the browser decrypts it client-side. The decryption key can be passed via the QR code URL anchor (e.g., `#key=...`) so it never touches the server.
2.  **Resumable Transfers:** Add support for `Range` headers to allow partial downloads. If a large zip transfer drops, the browser/client can resume where it left off.
3.  **Internet Routing (Relay Mode):** Like `croc`, add an optional flag (e.g., `--relay`) to generate a code or link that routes securely through a temporary public server, allowing transfers when devices aren't on the same Wi-Fi.

### What Existing Features/UX Can Be Improved
1.  **Browser Interface (UX):** Enhance the web page served during `--receive` mode with Drag & Drop support, progress bars, and a modern aesthetic. 
2.  **HTTPS by Default:** Automatically generate temporary, self-signed TLS certificates for local transfers so the connection is over HTTPS. This will prevent modern browsers from blocking certain downloads and features.
3.  **Terminal Output:** Add dynamic progress bars in the terminal during the transfer so the user knows the status of the upload/download in real-time.

### What Features or Complexities Can Be Removed to Streamline
1.  **mDNS Broadcasting (`--mdns`):** mDNS (Bonjour/Avahi) is notoriously unreliable across different routers, enterprise networks, and VPNs (as noted in the `filedrop` FAQ). Maintaining the mDNS dependency bloats the package. Relying purely on the explicit IP + QR code approach is often 100% reliable and simplifies the codebase.
2.  **Manual Network Interface Selection:** Streamline or deprecate the manual `-b, --bind` option by improving the auto-detection algorithm to natively rank interfaces (prioritizing Wi-Fi / LAN over virtual/Docker bridges).
