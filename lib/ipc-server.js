/**
 * IPC Server - Unix socket server for receiving hook pings
 *
 * Creates a Unix socket at /tmp/claude-matrix-<sessionId>.sock
 * Receives JSON payloads from hook-ping.js and emits 'hook' events.
 */

import { createServer } from "net";
import { EventEmitter } from "events";
import { existsSync, unlinkSync } from "fs";

const DEBUG = process.env.MATRIX_DEBUG === "1";

export class IPCServer extends EventEmitter {
  constructor(sessionId) {
    super();
    this.sessionId = sessionId;
    this.socketPath = `/tmp/claude-matrix-${sessionId}.sock`;
    this.server = null;
  }

  /**
   * Start the Unix socket server
   * @returns {string} The socket path
   */
  start() {
    // Clean up stale socket file if it exists
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch (e) {
        // Ignore errors removing stale socket
      }
    }

    this.server = createServer((connection) => {
      let data = "";

      connection.on("data", (chunk) => {
        data += chunk.toString();
      });

      connection.on("end", () => {
        try {
          const payload = JSON.parse(data);
          if (DEBUG) {
            console.log("[IPC] Received hook payload:", payload.type || "unknown");
          }
          this.emit("hook", payload);
        } catch (e) {
          if (DEBUG) {
            console.error("[IPC] Failed to parse hook payload:", e.message);
          }
        }
      });

      connection.on("error", (err) => {
        if (DEBUG) {
          console.error("[IPC] Connection error:", err.message);
        }
      });
    });

    this.server.on("error", (err) => {
      if (DEBUG) {
        console.error("[IPC] Server error:", err.message);
      }
    });

    this.server.listen(this.socketPath, () => {
      if (DEBUG) {
        console.log("[IPC] Server listening on:", this.socketPath);
      }
    });

    return this.socketPath;
  }

  /**
   * Stop the server and clean up socket file
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
        if (DEBUG) {
          console.log("[IPC] Socket file removed:", this.socketPath);
        }
      } catch (e) {
        // Ignore errors removing socket
      }
    }
  }
}
