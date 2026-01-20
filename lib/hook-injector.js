/**
 * Hook Injector - Generates Claude Code settings JSON with hooks configured
 *
 * Creates a settings object that configures hooks to ping the wrapper's Unix socket.
 * This allows the wrapper to work in ANY directory without relying on project .claude hooks.
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PING_PATH = join(__dirname, "hook-ping.js");

/**
 * Generate hook settings JSON with all hooks pointing to the IPC socket
 * @param {string} socketPath - Path to the Unix socket
 * @returns {string} JSON string for --settings flag
 */
export function generateHooksSettings(socketPath) {
  // The command that each hook will execute
  // Sets the socket path as env var and runs hook-ping.js
  const hookCmd = `CLAUDE_MATRIX_SOCKET="${socketPath}" node "${HOOK_PING_PATH}"`;

  const settings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: hookCmd,
              timeout: 10000, // 10 seconds
            },
          ],
        },
      ],
      PreToolUse: [
        {
          // Forward AskUserQuestion events to Matrix
          matcher: "AskUserQuestion",
          hooks: [
            {
              type: "command",
              command: hookCmd,
              timeout: 10000,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: hookCmd,
              timeout: 10000,
            },
          ],
        },
      ],
      Notification: [
        {
          hooks: [
            {
              type: "command",
              command: hookCmd,
              timeout: 10000,
            },
          ],
        },
      ],
    },
  };

  return JSON.stringify(settings);
}

/**
 * Get the path to the hook-ping.js script
 * @returns {string} Absolute path to hook-ping.js
 */
export function getHookPingPath() {
  return HOOK_PING_PATH;
}
