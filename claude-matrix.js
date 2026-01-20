#!/usr/bin/env node
/**
 * Jackpoint - Matrix Wrapper for Claude Code
 *
 * Wraps a CLI program with Matrix bidirectional communication.
 * Works in ANY directory without relying on project .claude hooks.
 *
 * Architecture:
 * - Starts a Unix socket server for receiving hook pings
 * - Injects hooks via --settings flag when spawning the program
 * - Hooks ping the socket instead of doing Matrix communication themselves
 * - All Matrix communication is handled centrally in this wrapper
 * - Matrix listener watches for incoming messages and injects to tmux
 *
 * Usage: jackpoint <program> [args...]
 *    e.g. jackpoint claude
 *         jackpoint claude --model sonnet
 */

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { MatrixListener } from "./matrix-listener.js";
import { IPCServer } from "./lib/ipc-server.js";
import { generateHooksSettings } from "./lib/hook-injector.js";
import {
  sendClaudeNotification,
  getSessionKey,
  getHostname,
  getTmuxPane,
  getGitRoot,
  isConfigured,
  runSetupWizard,
  getClient,
} from "./matrix-bridge.js";

const DEBUG = process.env.MATRIX_DEBUG === "1";

/**
 * Handle hook events received via IPC
 * Payload format matches Claude Code hook stdin:
 * - hook_event_name: "SessionStart" | "PreToolUse" | "Stop" | "Notification"
 * - session_id: string
 * - tool_name: string (for PreToolUse)
 * - tool_input: object (for PreToolUse)
 * - cwd: string
 * - transcript_path: string (for Stop)
 * - notification_type: string (for Notification)
 */
async function handleHookEvent(payload) {
  const { hook_event_name, session_id, tool_name, tool_input, cwd, transcript_path, notification_type, message } = payload;

  // Build session context for all events
  const sessionKey = getSessionKey(cwd);
  const sessionContext = {
    hostname: getHostname(),
    tmuxPane: getTmuxPane(),
    cwd: cwd,
    gitRoot: getGitRoot(cwd),
  };

  if (DEBUG) {
    console.log(`[Hook] Processing ${hook_event_name} event`);
  }

  try {
    switch (hook_event_name) {
      case "SessionStart":
        await sendClaudeNotification({
          type: "session_start",
          sessionId: session_id,
          cwd: cwd,
          sessionKey: sessionKey,
          sessionContext: sessionContext,
        });
        break;

      case "PreToolUse":
        if (tool_name === "AskUserQuestion") {
          await sendClaudeNotification({
            type: "question",
            sessionId: session_id,
            toolName: tool_name,
            questions: tool_input?.questions,
            cwd: cwd,
            sessionKey: sessionKey,
          });
        }
        break;

      case "Stop":
        // Try to get last message from transcript (JSONL format)
        let lastMessage = "Waiting for your input.";
        if (transcript_path) {
          try {
            const lines = readFileSync(transcript_path, "utf-8")
              .trim()
              .split("\n");
            // Find last assistant message
            for (let i = lines.length - 1; i >= 0; i--) {
              const entry = JSON.parse(lines[i]);
              const msg = entry.message;
              if (msg && msg.role === "assistant" && msg.content) {
                // Get text content, skip tool uses
                const textParts = Array.isArray(msg.content)
                  ? msg.content.filter((c) => c.type === "text")
                  : [];
                if (textParts.length > 0) {
                  lastMessage = textParts.map((t) => t.text).join("\n");
                  break;
                }
              }
            }
          } catch (e) {
            if (DEBUG) {
              console.error("[Hook] Error reading transcript:", e.message);
            }
          }
        }
        await sendClaudeNotification({
          type: "stop",
          sessionId: session_id,
          message: lastMessage,
          cwd: cwd,
          sessionKey: sessionKey,
        });
        break;

      case "Notification":
        // Only send idle_prompt notifications
        if (notification_type === "idle_prompt") {
          await sendClaudeNotification({
            type: "stop",
            sessionId: session_id,
            message: message || "Claude is idle",
            cwd: cwd,
            sessionKey: sessionKey,
          });
        }
        break;

      default:
        if (DEBUG) {
          console.log(`[Hook] Unknown hook event: ${hook_event_name}`);
        }
    }
  } catch (err) {
    if (DEBUG) {
      console.error(`[Hook] Error handling ${hook_event_name}:`, err.message);
    }
  }
}

async function main() {
  // Parse arguments: jackpoint <program> [args...]
  const args = process.argv.slice(2);

  // Handle --setup flag
  if (args[0] === "--setup" || args[0] === "-s") {
    await runSetupWizard();
    process.exit(0);
  }

  // Check if configured, run wizard if not
  if (!isConfigured()) {
    console.log("Jackpoint is not configured yet.\n");
    await runSetupWizard();
  }

  if (args.length === 0) {
    console.error("Usage: jackpoint <program> [args...]");
    console.error("       jackpoint --setup");
    console.error("");
    console.error("  e.g. jackpoint claude");
    console.error("       jackpoint claude --model sonnet");
    process.exit(1);
  }

  const program = args[0];
  const programArgs = args.slice(1);

  const sessionId = randomUUID();

  if (DEBUG) {
    console.log("[Jackpoint] Session ID:", sessionId);
    console.log("[Jackpoint] Program:", program);
  }

  // 1. Start IPC server for receiving hook pings
  const ipcServer = new IPCServer(sessionId);
  const socketPath = ipcServer.start();

  if (DEBUG) {
    console.log("[Jackpoint] IPC socket:", socketPath);
  }

  // 2. Generate settings JSON with hooks pointing to our socket
  const settingsJson = generateHooksSettings(socketPath);

  if (DEBUG) {
    console.log("[Jackpoint] Injecting hooks via --settings flag");
  }

  // 3. Authenticate with Matrix upfront (ensures session exists for listener)
  try {
    await getClient();
    if (DEBUG) {
      console.log("[Jackpoint] Matrix authenticated");
    }
  } catch (err) {
    console.error("[Jackpoint] Matrix authentication failed:", err.message);
    console.error("Run 'jackpoint --setup' to reconfigure.");
    ipcServer.stop();
    process.exit(1);
  }

  // 4. Start Matrix listener for incoming messages
  // Pass our tmux pane so we only handle messages for THIS session
  const myTmuxTarget = getTmuxPane(); // Returns "session:window.pane" format

  if (DEBUG) {
    console.log("[Jackpoint] Starting Matrix listener for tmux target:", myTmuxTarget);
  }

  const listener = new MatrixListener(myTmuxTarget);
  const listenerStarted = await listener.start();

  if (!listenerStarted && DEBUG) {
    console.error("[Jackpoint] Failed to start listener, continuing without it");
  }

  // 5. Handle hook pings from the IPC server
  ipcServer.on("hook", async (payload) => {
    await handleHookEvent(payload);
  });

  // 6. Build program arguments with injected settings
  const fullArgs = ["--settings", settingsJson, ...programArgs];

  if (DEBUG) {
    console.log(`[Jackpoint] Starting ${program} with injected hooks...`);
  }

  // 7. Spawn program with full stdio passthrough
  const child = spawn(program, fullArgs, {
    stdio: "inherit",
    detached: false,
  });

  // 8. Cleanup on exit
  function cleanup() {
    ipcServer.stop();
    listener.stop();
  }

  child.on("exit", (code, signal) => {
    if (DEBUG) {
      console.log(`\n[Jackpoint] ${program} exited with code ${code}`);
    }
    cleanup();
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    console.error(`[Jackpoint] Failed to start ${program}:`, err.message);
    cleanup();
    process.exit(1);
  });

  // Forward signals to child
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  // Refresh room mapping periodically (in case new sessions start)
  const refreshInterval = setInterval(() => {
    listener.refreshRoomMapping();
  }, 10000);

  child.on("exit", () => {
    clearInterval(refreshInterval);
  });
}

main().catch((err) => {
  console.error("[Jackpoint] Error:", err.message);
  process.exit(1);
});
