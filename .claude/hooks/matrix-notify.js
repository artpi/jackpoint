#!/usr/bin/env node

/**
 * Claude Code Hook: Matrix Notification
 *
 * This script is called by Claude Code hooks to send notifications to Matrix.
 * It reads JSON from stdin containing hook event data.
 *
 * Sessions are keyed by hostname:tmux_pane to persist Matrix rooms across
 * Claude Code restarts in the same tmux pane.
 */

import {
  sendClaudeNotification,
  getSessionKey,
  getHostname,
  getTmuxPane,
  getGitRoot,
} from "../../matrix-bridge.js";
import { readFileSync } from "fs";

async function main() {
  // Read JSON from stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    process.exit(0);
  }

  const data = JSON.parse(input);

  // Determine notification type based on hook event
  const hookEvent = data.hook_event_name;
  const sessionId = data.session_id || "unknown";
  const cwd = data.cwd;

  // Generate session key and context for room persistence
  const sessionKey = getSessionKey(cwd); // hostname:tmux_pane or hostname:cwd
  const hostname = getHostname();
  const tmuxPane = getTmuxPane();
  const gitRoot = getGitRoot(cwd);

  let notification = {
    sessionId,
    cwd,
    sessionKey,
    sessionContext: {
      hostname,
      tmuxPane,
      cwd,
      gitRoot,
    },
  };

  switch (hookEvent) {
    case "SessionStart":
      notification.type = "session_start";
      notification.message = `Session started in ${cwd}`;
      break;

    case "PreToolUse":
      // Check if it's AskUserQuestion
      if (data.tool_name === "AskUserQuestion") {
        notification.type = "question";
        notification.questions = data.tool_input?.questions || [];
      } else {
        // Skip other tools for now (too noisy)
        process.exit(0);
      }
      break;

    case "Stop":
      notification.type = "stop";
      // Try to get last message from transcript (JSONL format)
      let lastMessage = "Claude finished";
      if (data.transcript_path) {
        try {
          const lines = readFileSync(data.transcript_path, "utf-8")
            .trim()
            .split("\n");
          // Find last assistant message (structure: entry.message.role, entry.message.content)
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
                // Truncate if too long
                if (lastMessage.length > 500) {
                  lastMessage = lastMessage.slice(0, 500) + "...";
                }
                break;
              }
            }
          }
        } catch (e) {
          lastMessage = `Claude finished (error: ${e.message})`;
        }
      }
      notification.message = lastMessage;
      break;

    case "Notification":
      // Only send idle_prompt notifications
      if (data.notification_type === "idle_prompt") {
        notification.type = "stop";
        notification.message = data.message || "Claude is idle";
      } else {
        process.exit(0);
      }
      break;

    default:
      // Unknown event, skip
      process.exit(0);
  }

  await sendClaudeNotification(notification);

  // Exit successfully
  process.exit(0);
}

main().catch((err) => {
  // Log error to stderr but don't block Claude
  console.error("Matrix notification error:", err.message);
  process.exit(0); // Non-blocking exit
});
