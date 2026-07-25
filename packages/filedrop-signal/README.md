# `@dreamstick/filedrop-signal`

> Minimal, stateless WebSocket signaling and relay companion server for `filedrop` WebRTC mesh connections.

`@dreamstick/filedrop-signal` facilitates cross-network WebRTC peer discovery between `filedrop` instances by exchanging opaque signaling metadata (SDP offers/answers and ICE candidates) keyed by room codes.

---

## 🔒 Zero-Knowledge Privacy Guarantees

Security and user privacy are foundational design principles of `filedrop`:

- **Stateless Metadata Forwarding**: The signaling server only sees temporary 6-character room codes and peer connection lifecycle events (`peer-joined`, `peer-left`).
- **Zero Plaintext Visibility**: The server **never** sees or receives AES-256 decryption keys, filenames, directory structures, file sizes, or unencrypted file contents.
- **End-to-End Encryption**: End-to-end encryption is performed client-side. Even if a WebRTC connection falls back to relaying ciphertext frames over WebSocket, the server forwards opaque GCM ciphertext blocks verbatim and cannot decrypt them.
- **No Persistence**: Rooms, message queues, and peer state exist strictly in volatile process memory and are cleared automatically when peers disconnect or after the 60-second room TTL expires.

---

## 🚀 Quick Start & CLI Usage

### Install Globally via npm

```bash
npm install -g @dreamstick/filedrop-signal
```

### Start the Server

```bash
filedrop-signal --port 8443 --bind 0.0.0.0
```

### Options

| Flag | Default | Environment Variable | Description |
| --- | --- | --- | --- |
| `-p, --port <n>` | `8080` | `PORT` | TCP port to listen on |
| `-b, --bind <ip>` | `0.0.0.0` | `BIND_IP` | Network interface IP to bind |
| `--relay-password <sec>` | `""` | `RELAY_PASSWORD` | Optional shared secret required before relay accepts frames |
| `--allowed-origins <list>`| `""` | `ALLOWED_ORIGINS` | Comma-separated list of allowed origins (CSWSH prevention) |

---

## 🐳 Docker Deployment

Run a self-hosted signaling instance in one command:

```bash
docker run -d --name filedrop-signal -p 8443:8080 @dreamstick/filedrop-signal
```

Or build from source:

```bash
docker build -t filedrop-signal ./packages/filedrop-signal
docker run -d -p 8443:8080 filedrop-signal
```

---

## 💻 Connecting filedrop CLI

Point your `filedrop` client to your custom signaling server:

```bash
filedrop ./my-file.jpg --mesh --mesh-signal wss://signal.yourdomain.com
```

Or set the environment variable:

```bash
export FILEDROP_MESH_SIGNAL_URL=wss://signal.yourdomain.com
filedrop ./my-file.jpg --mesh
```

---

## 📡 Wire Protocol Specifications

### Client → Server Messages

- **Join Room**:
  ```json
  { "type": "join", "room": "ABC123", "role": "sender" }
  ```
- **Leave Room**:
  ```json
  { "type": "leave", "room": "ABC123" }
  ```
- **Forward Signal**:
  ```json
  { "type": "signal", "room": "ABC123", "payload": { "type": "offer", "sdp": "..." } }
  ```

### Server → Client Messages

- **Peer Joined Notification**:
  ```json
  { "type": "peer-joined", "peerId": "a1b2c3d4" }
  ```
- **Peer Left Notification**:
  ```json
  { "type": "peer-left", "peerId": "a1b2c3d4" }
  ```
- **Forwarded Signal**:
  ```json
  { "type": "signal", "from": "a1b2c3d4", "payload": { ... } }
  ```
- **Error Response**:
  ```json
  { "type": "error", "code": "ROOM_FULL | PAYLOAD_TOO_LARGE | RATE_LIMITED", "message": "..." }
  ```

---

## 📄 License

MIT © Dreamstick
