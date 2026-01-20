#!/usr/bin/env node
/**
 * Matrix Listener Module
 *
 * Listens for incoming Matrix messages and injects them into the appropriate
 * tmux session using `tmux send-keys`.
 */

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

import sdk from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger.js";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, ".matrix-session.json");
const ENV_FILE = join(__dirname, ".env");

// Check for debug mode
const DEBUG = process.env.MATRIX_DEBUG === "1";

// Load .env manually
function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const content = readFileSync(ENV_FILE, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }
  return env;
}

const env = loadEnv();
const MATRIX_HOMESERVER = env.MATRIX_HOMESERVER || "https://matrix.org";

// Disable verbose SDK logging unless in debug mode
if (!DEBUG) {
  logger.setLevel("silent");
}

// Load session config
function loadSession() {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  return {};
}

// Build reverse mapping: roomId -> sessionKey
function getRoomToSessionMap() {
  const session = loadSession();
  const reverseMap = {};
  if (session.rooms) {
    for (const [sessionKey, roomId] of Object.entries(session.rooms)) {
      reverseMap[roomId] = sessionKey;
    }
  }
  return reverseMap;
}

// Parse sessionKey to get tmux target
// Format: "hostname:tmux_session:window.pane" -> "tmux_session:window.pane"
function getTmuxTarget(sessionKey) {
  const parts = sessionKey.split(":");
  if (parts.length >= 3) {
    // hostname:session:window.pane -> session:window.pane
    return parts.slice(1).join(":");
  } else if (parts.length === 2) {
    // hostname:path (fallback, no tmux) -> null
    return null;
  }
  return null;
}

// Escape message for tmux send-keys
function escapeForTmux(message) {
  // Escape special characters for shell
  return message
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

// Send message to tmux pane
function sendToTmux(target, message) {
  try {
    const escaped = escapeForTmux(message);
    // Use -l (literal) for text, then send C-m (raw Enter) separately
    execSync(`tmux send-keys -t "${target}" -l "${escaped}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    // Send Enter as C-m (Ctrl-M) which is the raw Enter keycode
    execSync(`tmux send-keys -t "${target}" C-m`, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    return true;
  } catch (e) {
    console.error(`[Listener] Failed to send to tmux ${target}:`, e.message);
    return false;
  }
}

export class MatrixListener {
  /**
   * @param {string|null} myTmuxTarget - If provided, only inject messages to this tmux target.
   *                                      This prevents duplicate injection when multiple wrappers run.
   */
  constructor(myTmuxTarget = null) {
    this.client = null;
    this.syncReady = false;
    this.roomToSession = {};
    this.processedEvents = new Set(); // Deduplicate events
    this.myTmuxTarget = myTmuxTarget; // Only handle messages for this target
  }

  async start() {
    const session = loadSession();

    if (!session.accessToken || !session.userId) {
      console.error("[Listener] No Matrix session found. Run claude first to authenticate.");
      return false;
    }

    // Build room -> session mapping
    this.roomToSession = getRoomToSessionMap();
    if (DEBUG) {
      console.log("[Listener] Watching rooms:", Object.keys(this.roomToSession));
    }

    // Create client with sync support
    this.client = sdk.createClient({
      baseUrl: MATRIX_HOMESERVER,
      accessToken: session.accessToken,
      userId: session.userId,
    });

    // Listen for new messages
    this.client.on("Room.timeline", (event, room, toStartOfTimeline) => {
      // Ignore historical messages during initial sync
      if (toStartOfTimeline) return;
      if (!this.syncReady) return;

      // Only handle text messages
      if (event.getType() !== "m.room.message") return;

      const content = event.getContent();
      if (content.msgtype !== "m.text") return;

      // Ignore our own messages
      if (event.getSender() === session.userId) return;

      // Deduplicate - skip if we've already processed this event
      const eventId = event.getId();
      if (this.processedEvents.has(eventId)) {
        if (DEBUG) {
          console.log(`[Listener] Skipping duplicate event: ${eventId}`);
        }
        return;
      }
      this.processedEvents.add(eventId);

      // Limit set size to prevent memory leak
      if (this.processedEvents.size > 1000) {
        const firstId = this.processedEvents.values().next().value;
        this.processedEvents.delete(firstId);
      }

      const roomId = room.roomId;
      const message = content.body;

      if (DEBUG) {
        console.log(`[Listener] Message in ${roomId}: ${message.substring(0, 50)}...`);
      }

      // Look up tmux target for this room
      const sessionKey = this.roomToSession[roomId];
      if (!sessionKey) {
        if (DEBUG) {
          console.log(`[Listener] Room ${roomId} not mapped to a session`);
        }
        return;
      }

      const tmuxTarget = getTmuxTarget(sessionKey);
      if (!tmuxTarget) {
        console.log(`[Listener] Session ${sessionKey} has no tmux target`);
        return;
      }

      // If we have a specific target filter, only inject messages for that target
      if (this.myTmuxTarget && tmuxTarget !== this.myTmuxTarget) {
        if (DEBUG) {
          console.log(`[Listener] Skipping message for ${tmuxTarget} (not my target: ${this.myTmuxTarget})`);
        }
        return;
      }

      if (DEBUG) {
        console.log(`[Listener] Sending to tmux target: ${tmuxTarget}`);
      }
      sendToTmux(tmuxTarget, message);
    });

    // Mark ready after initial sync
    this.client.on("sync", (state) => {
      if (state === "PREPARED") {
        this.syncReady = true;
        if (DEBUG) {
          console.log("[Listener] Sync complete, listening for messages...");
        }
      }
    });

    // Start syncing
    await this.client.startClient({ initialSyncLimit: 0 });
    if (DEBUG) {
      console.log("[Listener] Matrix client started");
    }

    return true;
  }

  // Refresh room mapping (call when new sessions start)
  refreshRoomMapping() {
    this.roomToSession = getRoomToSessionMap();
    if (DEBUG) {
      console.log("[Listener] Refreshed room mapping:", Object.keys(this.roomToSession));
    }
  }

  stop() {
    if (this.client) {
      this.client.stopClient();
      if (DEBUG) {
        console.log("[Listener] Matrix client stopped");
      }
    }
  }
}

// CLI usage - run standalone for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const listener = new MatrixListener();

  process.on("SIGINT", () => {
    listener.stop();
    process.exit(0);
  });

  listener.start().catch((err) => {
    console.error("[Listener] Error:", err.message);
    process.exit(1);
  });
}
