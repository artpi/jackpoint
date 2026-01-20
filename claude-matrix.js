#!/usr/bin/env node
/**
 * Claude Code Matrix Wrapper
 *
 * Wraps the `claude` CLI with Matrix bidirectional communication.
 * - Starts a Matrix listener that watches for incoming messages
 * - Spawns claude with full stdio passthrough
 * - Injects Matrix messages into the tmux pane
 * - Stops listener when claude exits
 *
 * Usage: node claude-matrix.js [claude args...]
 *    or: ./claude-matrix.js [claude args...]
 */

import { spawn } from "child_process";
import { MatrixListener } from "./matrix-listener.js";

const DEBUG = process.env.MATRIX_DEBUG === "1";

async function main() {
  if (DEBUG) {
    console.log("[Claude-Matrix] Starting Matrix listener...");
  }

  const listener = new MatrixListener();
  const started = await listener.start();

  if (!started) {
    console.error("[Claude-Matrix] Failed to start listener, continuing without it");
  }

  // Get claude arguments (everything after this script)
  const claudeArgs = process.argv.slice(2);

  if (DEBUG) {
    console.log("[Claude-Matrix] Starting claude...");
  }

  // Spawn claude with full stdio passthrough
  const claude = spawn("claude", claudeArgs, {
    stdio: "inherit",
    // Ensure signals propagate
    detached: false,
  });

  // Handle claude exit
  claude.on("exit", (code, signal) => {
    if (DEBUG) {
      console.log(`\n[Claude-Matrix] Claude exited with code ${code}`);
    }
    listener.stop();
    process.exit(code || 0);
  });

  claude.on("error", (err) => {
    console.error("[Claude-Matrix] Failed to start claude:", err.message);
    listener.stop();
    process.exit(1);
  });

  // Forward signals to claude
  process.on("SIGINT", () => {
    claude.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    claude.kill("SIGTERM");
  });

  // Refresh room mapping periodically (in case new sessions start)
  const refreshInterval = setInterval(() => {
    listener.refreshRoomMapping();
  }, 10000);

  claude.on("exit", () => {
    clearInterval(refreshInterval);
  });
}

main().catch((err) => {
  console.error("[Claude-Matrix] Error:", err.message);
  process.exit(1);
});
