#!/usr/bin/env node
/**
 * Hook Ping - Lightweight script that forwards hook stdin to the wrapper's Unix socket
 *
 * This script is called by Claude Code hooks. It:
 * 1. Reads JSON from stdin (hook payload)
 * 2. Connects to the wrapper's Unix socket (path in CLAUDE_MATRIX_SOCKET env var)
 * 3. Writes the payload to the socket
 * 4. Exits
 *
 * Fails silently if socket not available (wrapper not running).
 * Zero external dependencies - uses only Node.js built-ins.
 */

import { connect } from "net";

const socketPath = process.env.CLAUDE_MATRIX_SOCKET;

// Exit silently if no socket configured
if (!socketPath) {
  process.exit(0);
}

// Read all stdin
let input = "";

process.stdin.setEncoding("utf8");

process.stdin.on("readable", () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    input += chunk;
  }
});

process.stdin.on("end", () => {
  if (!input.trim()) {
    process.exit(0);
  }

  // Connect to socket and send data
  const client = connect(socketPath, () => {
    client.write(input);
    client.end();
  });

  client.on("error", () => {
    // Fail silently - wrapper might not be running
    process.exit(0);
  });

  client.on("close", () => {
    process.exit(0);
  });
});

// Handle stdin errors silently
process.stdin.on("error", () => {
  process.exit(0);
});
