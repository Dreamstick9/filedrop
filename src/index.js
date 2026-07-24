#!/usr/bin/env node

const { parseArgs } = require("./cli");
const path = require("path");
const crypto = require("crypto");
const clipboardy = require("clipboardy").default || require("clipboardy");
const fs = require("fs");
const { confirmSensitiveFile } = require("./security");
const { handleUnexpectedError } = require("./errors");

// Assumed imports from other agents
const network = require("./network");
const portManager = require("./port");
const mdns = require("./mdns");
const server = require("./server");
const qr = require("./qr");
const { SignalingRoom } = require("./signaling");
const { pickTransport } = require("./transport");

/**
 * Module interfaces:
 *
 * network.js:
 *   getInterface(options?: { bind?: string, verbose?: boolean }): { name: string, info: os.NetworkInterfaceInfo }
 *
 * port.js:
 *   findAvailablePort(startPort?: number, endPort?: number): Promise<number>
 *
 * mdns.js:
 *   announce(config: { mdnsName: string, filename: string, size: number, transferId: string, ip: string, port: number, verbose?: boolean }): Promise<{ name: string, mdnsAvailable: boolean }>
 *   deregister(): Promise<void>
 *
 * server.js:
 *   createServer(options: { filePath: string, port: number, options: object, onTransferStart: () => void, onTransferComplete: () => void, onTransferError: (err: Error) => void }): Promise<{ server: http.Server, shutdown: () => Promise<void>, keyHex: string, downloadPath: string }>
 *
 * qr.js:
 *   renderQR(url: string, options?: object): string
 *   renderMetadataBox(filename: string, sizeHuman: string, url: string, mdnsName: string, options?: object): void
 *   updateStatus(status: string, options?: object): void
 */

const { LifecycleManager, STATES } = require("./lifecycle");

async function main() {
  // 1. Parse and validate arguments
  const config = parseArgs(process.argv);

  // Check for sensitive files
  if (config.warnSensitive && !config.isClipboard) {
    const readline = require("readline");

    async function confirmUnreadablePath(p) {
      console.log(
        `\x1b[33mWarning: Could not read/inspect path: ${p}. Proceed anyway? [y/N]\x1b[0m`,
      );
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise((resolve) => {
        rl.question("", (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === "y");
        });
      });
    }

    async function getFilesRecursively(dir) {
      let results = [];
      let list;
      try {
        list = fs.readdirSync(dir);
      } catch (err) {
        const confirmed = await confirmUnreadablePath(dir);
        if (!confirmed) {
          console.log("Transfer aborted by user.");
          process.exit(1);
        }
        return [];
      }
      for (const file of list) {
        const filePath = path.join(dir, file);
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch (err) {
          const confirmed = await confirmUnreadablePath(filePath);
          if (!confirmed) {
            console.log("Transfer aborted by user.");
            process.exit(1);
          }
          continue;
        }
        if (stat && stat.isDirectory()) {
          const subFiles = await getFilesRecursively(filePath);
          results = results.concat(subFiles);
        } else {
          results.push(filePath);
        }
      }
      return results;
    }

    let filesToCheck = [];
    if (config.isMultiFile) {
      filesToCheck = config.filePaths;
    } else if (config.isDirectory) {
      filesToCheck = [config.filePath].concat(
        await getFilesRecursively(config.filePath),
      );
    } else {
      filesToCheck = [config.filePath];
    }

    for (const filePath of filesToCheck) {
      const confirmed = await confirmSensitiveFile(filePath);
      if (!confirmed) {
        console.log("Transfer aborted by user.");
        process.exit(1);
      }
    }
  }

  // Initialize Lifecycle Manager
  const lifecycle = new LifecycleManager(config);

  // Bind core modules to the lifecycle event bus
  network.bind(lifecycle);
  portManager.bind(lifecycle);
  mdns.bind(lifecycle);
  server.bind(lifecycle);

  // Orchestration state variables
  let ip;
  let port;
  let filename;
  let clipboardData = null;
  let calculatedBoxWidth = 43;
  let isTransferring = false;
  let url;
  let mdnsName;
  let keyHex;

  // Resolve Exit Promise (helps coordinate asynchronous tests)
  const exitPromise = new Promise((resolve) => {
    lifecycle.on("stateChange", ({ newState }) => {
      if (newState === STATES.EXITED) {
        resolve();
      }
    });
  });

  // 1. Network Discovery
  lifecycle.on("network:resolved", (iface) => {
    ip = iface.info.address;

    if (config.isClipboard) {
      try {
        clipboardData = clipboardy.readSync();
        if (!clipboardData) {
          console.error("filedrop: error: Clipboard is empty");
          lifecycle.exitCleanly(1);
          return;
        }
        filename = "clipboard.txt";
      } catch (err) {
        console.error(
          `filedrop: error: Failed to read clipboard: ${err.message}`,
        );
        lifecycle.exitCleanly(1);
        return;
      }
    } else if (config.isMultiFile) {
      filename = "filedrop-bundle.zip";
    } else if (config.isDirectory) {
      filename = path.basename(config.filePath) + ".zip";
    } else {
      filename = path.basename(config.filePath);
    }

    // Trigger port discovery
    lifecycle.emit("port:resolve", {
      port: config.port,
      startPort: 8000,
      endPort: 8999,
    });
  });

  lifecycle.on("network:error", (err) => {
    console.error(
      `filedrop: error: ${err.message || "No network interface found"}`,
    );
    lifecycle.exitCleanly(2);
  });

  // 2. Port Discovery
  lifecycle.on("port:resolved", async (resolvedPort) => {
    port = resolvedPort;

    let limit = 1;
    if (config.downloadLimit !== undefined) {
      limit = config.downloadLimit;
    } else if (process.stdin.isTTY) {
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      limit = await new Promise((resolve) => {
        readline.question(
          "How many devices will download this file? [1]: ",
          (ans) => {
            readline.close();
            const n = Number(ans);
            resolve(Number.isInteger(n) && n > 0 ? n : 1);
          },
        );
      });
    }

    // Trigger HTTP server start
    lifecycle.emit("server:start", {
      filePath: config.filePath,
      filePaths: config.filePaths,
      isMultiFile: config.isMultiFile,
      clipboardData,
      isClipboard: config.isClipboard,
      port: port,
      bindIp: config.bind ? ip : undefined,
      isDirectory: config.isDirectory,
      downloadLimit: limit,
      options: {
        timeout: config.timeout,
        verbose: config.verbose,
        rateLimitWindow: config.rateLimitWindow,
        rateLimitMax: config.rateLimitMax,
        token: config.token,
        maxConnections: config.maxConnections,
      },
    });
  });

  lifecycle.on("port:error", (err) => {
    console.error(`filedrop: error: ${err.message || "Port exhausted"}`);
    lifecycle.exitCleanly(3);
  });

  // 3. Server Started
  lifecycle.on("server:started", async (data) => {
    keyHex = data.keyHex;
    url = `http://${ip}:${port}/${config.token ? `?t=${encodeURIComponent(config.token)}` : ""}#${keyHex}`;

    // Initialize mDNS module (non-blocking)
    mdnsName =
      config.name ||
      filename
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase()
        .substring(0, 15) + "-filedrop";
    const transferId = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2);

    // Generate Room Code for signaling/MeshTransport
    let roomCode = null;
    if (config.mesh) {
      const { generateRoomCode } = require("./room-code");
      roomCode = generateRoomCode();
    }
    const roomId = roomCode || transferId;

    // Kick off mDNS announce and signaling room join in parallel
    if (config.mdns) {
      lifecycle.emit("mdns:announce", {
        mdnsName: config.name,
        filename: filename,
        size: config.fileSize,
        transferId: roomId,
        ip: ip,
        port: port,
        verbose: config.verbose,
      });
    }

    let signalingRoom = null;
    if (config.signalUrl && config.mesh !== false) {
      signalingRoom = new SignalingRoom(config.signalUrl, roomId);
      if (config.verbose) {
        console.log(
          `[filedrop:signaling] Joining signaling room in parallel: ${config.signalUrl} (room: ${roomId})`,
        );
      }
      signalingRoom.join().catch((err) => {
        if (config.verbose) {
          console.warn(
            `[filedrop:signaling] Failed to join signaling room: ${err.message}`,
          );
        }
      });
    }

    const chosenTransport = await pickTransport({
      mesh: config.mesh,
      signalUrl: config.signalUrl,
      mdns: mdns,
      timeoutMs: 3000,
      verbose: config.verbose,
    });

    console.log(
      `[filedrop:transport] Transport selected: ${chosenTransport.toUpperCase()}`,
    );

    if (chosenTransport === "lan" && signalingRoom) {
      if (config.verbose) {
        console.log(
          "[filedrop:signaling] LAN selected. Tearing down signaling room cleanly...",
        );
      }
      await signalingRoom.leave();
    } else if (signalingRoom) {
      lifecycle.on("shutdown", (cleanups) => {
        cleanups.push(signalingRoom.leave());
      });
    }

    if (chosenTransport === "mesh") {
      const { MeshTransport } = require("./transport-mesh");
      const meshTransport = new MeshTransport({
        filePath: config.filePath,
        filePaths: config.filePaths,
        isMultiFile: config.isMultiFile,
        isDirectory: config.isDirectory,
        isClipboard: config.isClipboard,
        clipboardData: clipboardData,
        signalUrl: config.signalUrl,
        transferId: roomId,
        keyHex: keyHex,
        relay: config.relay,
        relayPassword: config.relayPassword,
        iceTimeout: config.iceTimeout,
        onStatusUpdate: (status) => {
          qr.updateStatus(status, { color: config.color }, calculatedBoxWidth);
        },
        onTransferStart: (current, limit) => {
          isTransferring = true;
          if (lifecycle.state === STATES.WAITING) {
            lifecycle.transition(STATES.TRANSFERRING, { socket: null });
          }
          lifecycle.emit("server:transfer-start", {
            currentCount: current,
            limit,
          });
        },
        onTransferComplete: (completed, limit) => {
          isTransferring = false;
          lifecycle.emit("server:transfer-complete", {
            completedCount: completed,
            downloadLimit: limit,
          });
        },
        onTransferError: (err) => {
          isTransferring = false;
          lifecycle.emit("server:transfer-error", err);
        },
        verbose: config.verbose,
      });

      await meshTransport.start();
      lifecycle.on("shutdown", (cleanups) => {
        cleanups.push(meshTransport.shutdown());
      });

      // Render and print Mesh QR code + room codebox
      const signalHost = config.signalHost || "https://signal.filedrop.local";
      const finalMeshUrl = `${signalHost.replace(/\/+$/, "")}/r/${roomId}${config.relayPassword ? `?rp=${encodeURIComponent(config.relayPassword)}` : ""}#${keyHex}`;

      if (config.qr) {
        const qrString = qr.renderQR(finalMeshUrl, {
          compact: config.qrCompact,
          noQr: false,
          color: config.color,
        });
        console.log(qrString);
      } else {
        console.log(`Mesh signal: ${finalMeshUrl}`);
      }

      const meshBox = qr.renderMeshCodeBox(roomId, { color: config.color });
      calculatedBoxWidth = meshBox.split("\n")[1].length - 6; // estimate box width
      console.log(meshBox);
    } else {
      // Render and print LAN QR code + metadata box
      if (config.qr) {
        const qrString = qr.renderQR(url, {
          compact: config.qrCompact,
          noQr: false,
          color: config.color,
        });
        console.log(qrString);
        if (!config.qrCompact) {
          let sizeDisplay;
          if (config.isClipboard) {
            sizeDisplay = "Clipboard Text";
          } else {
            sizeDisplay = config.isDirectory
              ? "(streaming zip)"
              : config.fileSize + " bytes";
          }

          const { output, boxWidth } = qr.renderMetadataBox(
            filename,
            sizeDisplay,
            url,
            config.mdns ? mdnsName : null,
            { color: config.color },
          );
          calculatedBoxWidth = boxWidth;
          console.log(output);
        }
      } else {
        console.log(`URL: ${url}`);
        if (config.mdns) {
          console.log(
            `mDNS: http://${mdnsName}.local:${port}/${config.token ? `?t=${encodeURIComponent(config.token)}` : ""}#${keyHex}`,
          );
        }
      }
    }

    // Transition lifecycle to READY then WAITING
    lifecycle.transition(STATES.READY);
    lifecycle.transition(STATES.WAITING);
  });

  lifecycle.on("server:error", (err) => {
    console.error(`\nTransfer error: ${err.message}`);
    lifecycle.exitCleanly(1);
  });

  // 4. Server Transfer Events
  lifecycle.on("server:transfer-start", ({ currentCount, limit }) => {
    isTransferring = true;
    if (lifecycle.state === STATES.WAITING) {
      lifecycle.transition(STATES.TRANSFERRING, { socket: null });
    }
    if (limit > 1) {
      qr.updateStatus(
        `transferring (${currentCount}/${limit})`,
        { color: config.color },
        calculatedBoxWidth,
      );
    } else {
      qr.updateStatus(
        "transferring",
        { color: config.color },
        calculatedBoxWidth,
      );
    }
  });

  lifecycle.on(
    "server:transfer-complete",
    ({ completedCount, downloadLimit }) => {
      qr.updateStatus(
        `Downloads: ${completedCount} / ${downloadLimit}`,
        { color: config.color },
        calculatedBoxWidth,
      );
      if (completedCount >= downloadLimit) {
        isTransferring = false;
        qr.updateStatus("done", { color: config.color }, calculatedBoxWidth);
        lifecycle.transition(STATES.COMPLETE, {
          bytesTransferred: config.fileSize,
        });
      }
    },
  );

  lifecycle.on("server:transfer-error", (err) => {
    isTransferring = false;
    if (err.message && err.message.includes("ERR_CLIENT_DISCONNECTED")) {
      // Disconnect frees the slot, server remains active
    } else {
      console.error(`\nTransfer error: ${err.message}`);
      lifecycle.transition(STATES.FAILED, { error: err, exitCode: 1 });
    }
  });

  lifecycle.on("timeout", () => {
    console.error(`\nTransfer timed out after ${config.timeout} seconds.`);
  });

  // Render mesh room code box block removed (handled dynamically during startup)

  // Signal Handling
  let isShuttingDown = false;
  const handleExit = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (isTransferring) {
      console.log("\nTransfer in progress — waiting for completion...");
      // Wait for the configured grace period before force-exiting
      setTimeout(() => {
        process.stdout.write("\nForcing exit.\n");
        process.exit(130);
      }, config.shutdownGraceMs);
      return;
    }

    process.stdout.write("\n"); // Terminal may be mid-line
    console.log("Interrupted. No file was transferred.");

    await lifecycle.exitCleanly(130);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  // Start network discovery
  lifecycle.emit("network:discover", {
    bind: config.bind,
    verbose: config.verbose,
  });

  // Block until exited
  await exitPromise;
}

main().catch(handleUnexpectedError);
