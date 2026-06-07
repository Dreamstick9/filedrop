# HTTP Server Core — Implementation Notes

## Deviations & Decisions
1. **Module Parameters Interface:** To cleanly accept the inputs outlined in the agent prompt while complying with the System Architect's module map, the `createServer` API is implemented to accept an options object `params` that includes `filePath`, `port`, `options`, `onTransferComplete`, and `onTransferError`.
2. **mDNS Unregister Dependency:** The specification calls for the shutdown method to unregister the mDNS service. Since `server.js` shouldn't depend on the mDNS layer directly, this is implemented via an injected callback `options.onShutdown`.
3. **Range Headers (Partial Content):** The server explicitly rejects `Range` requests with `416 Range Not Satisfiable` to uphold the strict, one-shot architecture of the tool. Resumable downloads are not supported.
4. **Concurrent Requests:** Any `GET` requests hitting the server while a transfer is actively streaming or already completed will immediately return `410 Gone` and forcefully destroy the socket, preventing file leakage or lockups.
5. **Transfer Completion Handling:** `socket.on('close')` combined with `res.on('finish')` is utilized as prescribed. A `transferConcluded` flag guarantees `onTransferComplete` and `onTransferError` are only invoked once per transfer lifecycle.
