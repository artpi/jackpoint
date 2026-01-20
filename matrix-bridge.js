#!/usr/bin/env node

// Polyfill for Node.js < 22 (Promise.withResolvers is used by matrix-js-sdk 40+)
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Silence SDK logging - must be imported first
import "./lib/silence-sdk.js";

import sdk from "matrix-js-sdk";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { hostname } from "os";
import {
  getConfig,
  loadSession,
  saveSession,
  isConfigured,
  runSetupWizard,
} from "./lib/config.js";

// Check for debug mode
const DEBUG = process.env.MATRIX_DEBUG === "1";

// Get config values
const config = getConfig();
const MATRIX_HOMESERVER = config.homeserver;
const MATRIX_USER = config.user;
const MATRIX_PASS = config.password;
const MATRIX_RECIPIENT = config.recipient;

// Get tmux session identifier (session:window.pane format)
export function getTmuxPane() {
  try {
    const result = execSync("tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch (e) {
    // Not in tmux or tmux not available
    return null;
  }
}

// Get current hostname
export function getHostname() {
  return hostname();
}

// Get git root directory for a given path
export function getGitRoot(cwd) {
  if (!cwd) return null;
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch (e) {
    // Not in a git repo
    return null;
  }
}

// Generate session key from hostname and tmux pane (or directory as fallback)
export function getSessionKey(cwd = null) {
  const host = getHostname();
  const pane = getTmuxPane();
  if (pane) {
    return `${host}:${pane}`;
  }
  // Not in tmux, fall back to hostname:directory
  if (cwd) {
    return `${host}:${cwd}`;
  }
  return `${host}:default`;
}

// Re-export for use by other modules
export { isConfigured, runSetupWizard };

// Get authenticated client (exported for upfront auth)
export async function getClient() {
  const session = loadSession();

  // Try existing token first
  if (session.accessToken && session.userId) {
    const client = sdk.createClient({
      baseUrl: MATRIX_HOMESERVER,
      accessToken: session.accessToken,
      userId: session.userId,
    });

    // Verify token still works
    try {
      await client.whoami();
      return { client, session };
    } catch (e) {
      // Token expired, need to login again
    }
  }

  // Login with password
  if (!MATRIX_USER || !MATRIX_PASS) {
    throw new Error("Matrix credentials not configured. Run 'jackpoint --setup' to configure.");
  }

  const tempClient = sdk.createClient({ baseUrl: MATRIX_HOMESERVER });
  const response = await tempClient.login("m.login.password", {
    user: MATRIX_USER,
    password: MATRIX_PASS,
  });

  const newSession = {
    accessToken: response.access_token,
    userId: response.user_id,
  };
  saveSession(newSession);

  const client = sdk.createClient({
    baseUrl: MATRIX_HOMESERVER,
    accessToken: response.access_token,
    userId: response.user_id,
  });

  return { client, session: newSession };
}

// Create a new room for this session
async function createSessionRoom(client, recipientId, sessionName) {
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const roomName = sessionName
    ? `Claude: ${sessionName}`
    : `Claude ${timestamp}`;

  const room = await client.createRoom({
    preset: "trusted_private_chat",
    invite: [recipientId],
    is_direct: true,
    name: roomName,
  });

  return room.room_id;
}

// Get or create room for current session (persisted by session key)
async function getSessionRoom(client, recipientId, sessionKey, sessionName) {
  const session = loadSession();

  // Initialize rooms map if it doesn't exist
  if (!session.rooms) {
    session.rooms = {};
  }

  // If we have a session key, try to find existing room
  if (sessionKey && session.rooms[sessionKey]) {
    const existingRoomId = session.rooms[sessionKey];
    // Verify we're still in the room
    try {
      const { joined_rooms } = await client.getJoinedRooms();
      if (joined_rooms.includes(existingRoomId)) {
        // Update currentRoom for typing indicator
        session.currentRoom = existingRoomId;
        saveSession(session);
        return { roomId: existingRoomId, isExisting: true };
      }
    } catch (e) {
      // Room no longer valid, will create new
    }
  }

  // Create new room
  const roomId = await createSessionRoom(client, recipientId, sessionName);

  // Store in rooms map if we have a session key
  if (sessionKey) {
    session.rooms[sessionKey] = roomId;
  }
  session.currentRoom = roomId;
  saveSession(session);

  return { roomId, isExisting: false };
}

// Send a message to Matrix
export async function sendNotification(
  message,
  recipient = MATRIX_RECIPIENT,
  sessionKey = null,
  roomName = null
) {
  const { client } = await getClient();
  const { roomId, isExisting } = await getSessionRoom(client, recipient, sessionKey, roomName);
  await client.sendTextMessage(roomId, message);
  return { roomId, isExisting };
}

// Set typing indicator in current room
export async function setTyping(isTyping = true) {
  const { client } = await getClient();
  const session = loadSession();

  if (!session.currentRoom) {
    return; // No room yet, skip silently
  }

  await client.sendTyping(session.currentRoom, isTyping, isTyping ? 30000 : undefined);
}

// Send formatted notification with context
export async function sendClaudeNotification({
  type,
  sessionId,
  message,
  toolName,
  toolInput,
  questions,
  cwd,
  sessionKey,
  sessionContext, // { hostname, tmuxPane, cwd, gitRoot }
}) {
  let text = "";
  let roomName = null;
  let typing = null; // null = don't change, true = start, false = stop

  switch (type) {
    case "session_start":
      // Use sessionKey directly as room name (it's the internal identifier)
      roomName = sessionKey || "claude-session";
      // Text will be set after we know if room is new or existing
      typing = true; // Agent is starting work
      break;

    case "question":
      text = `❓ **Claude is asking:**\n\n`;
      if (questions && questions.length > 0) {
        for (const q of questions) {
          text += `**${q.header || "Question"}:** ${q.question}\n`;
          if (q.options) {
            text += "Options:\n";
            q.options.forEach((opt, i) => {
              text += `  ${i + 1}. ${opt.label} - ${opt.description}\n`;
            });
          }
          text += "\n";
        }
      } else {
        text += message || "(no question text)";
      }
      typing = false; // Waiting for user input
      break;

    case "stop":
      text = message || "Waiting for your input.";
      typing = false; // Waiting for user input
      break;

    case "tool_use":
      text = `🔧 **Tool:** ${toolName}\n${message || ""}`;
      typing = true; // Agent is working
      break;

    case "permission":
      text = `🔐 **Permission Required**`;
      if (toolName) {
        text += `: ${toolName}`;
      }
      text += "\n";
      if (toolInput) {
        // Format based on tool type
        if (toolName === "Bash" && toolInput.command) {
          text += `\`\`\`\n${toolInput.command}\n\`\`\``;
        } else if ((toolName === "Edit" || toolName === "Write") && toolInput.file_path) {
          text += `File: \`${toolInput.file_path}\``;
        } else if (toolName === "Read" && toolInput.file_path) {
          text += `File: \`${toolInput.file_path}\``;
        } else {
          // Generic: show tool input as JSON
          text += `\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``;
        }
      } else if (message) {
        // Fallback to message if no tool input (from Notification event)
        text += message;
      }
      typing = false; // Waiting for permission
      break;

    default:
      text = message || "Notification from Claude Code";
  }

  // For session_start, we need to check if room exists first to format the message
  if (type === "session_start") {
    const { client } = await getClient();
    const { roomId, isExisting } = await getSessionRoom(client, MATRIX_RECIPIENT, sessionKey, roomName);

    // Format the session start/continue message with context
    const startCtx = sessionContext || {};
    const contextLines = [
      startCtx.hostname ? `Host: \`${startCtx.hostname}\`` : null,
      startCtx.tmuxPane ? `Tmux: \`${startCtx.tmuxPane}\`` : null,
      startCtx.cwd ? `Dir: \`${startCtx.cwd}\`` : null,
      startCtx.gitRoot ? `Git: \`${startCtx.gitRoot}\`` : null,
    ].filter(Boolean);

    if (isExisting) {
      text = `---\n📍 **New Session**\n${contextLines.join("\n")}`;
    } else {
      text = `🚀 **Claude Code Session Started**\n${contextLines.join("\n")}`;
    }

    await client.sendTextMessage(roomId, text);

    // Update typing indicator
    if (typing !== null) {
      await setTyping(typing);
    }

    return { roomId, isExisting };
  }

  const result = await sendNotification(text, undefined, sessionKey, roomName);

  // Update typing indicator after sending (so room exists)
  if (typing !== null) {
    await setTyping(typing);
  }

  return result;
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Read JSON from stdin (for hook usage)
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    if (input.trim()) {
      const data = JSON.parse(input);
      await sendClaudeNotification(data);
      console.log("Notification sent");
    } else {
      console.log("Usage:");
      console.log('  echo \'{"type":"stop"}\' | node matrix-bridge.js');
      console.log('  node matrix-bridge.js "Your message here"');
    }
  } else {
    // Direct message from CLI args
    const message = args.join(" ");
    await sendNotification(message);
    console.log("Message sent:", message);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
