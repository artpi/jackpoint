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

// Silence SDK logging - must be imported first
import "./lib/silence-sdk.js";

import sdk from "matrix-js-sdk";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { getConfig, loadSession } from "./lib/config.js";

const DEBUG = process.env.MATRIX_DEBUG === "1";

// Get config
const config = getConfig();
const MATRIX_HOMESERVER = config.homeserver;

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
      if (DEBUG) {
        console.log("[Listener] No Matrix session found");
      }
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
    this.session = session;

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
      if (event.getSender() === this.session.userId) return;

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
        if (DEBUG) {
          console.log(`[Listener] Session ${sessionKey} has no tmux target`);
        }
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
