/**
 * Jackpoint Configuration Manager
 *
 * Stores config in ~/.jackpoint/config.json
 * Stores session in ~/.jackpoint/session.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import * as readline from "readline";

// Silence SDK logging - must be imported before matrix-js-sdk
import "./silence-sdk.js";
import sdk from "matrix-js-sdk";

const CONFIG_DIR = join(homedir(), ".jackpoint");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SESSION_FILE = join(CONFIG_DIR, "session.json");

// Ensure config directory exists
function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Load config
export function loadConfig() {
  ensureConfigDir();
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  return {};
}

// Save config
export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Load session
export function loadSession() {
  ensureConfigDir();
  if (existsSync(SESSION_FILE)) {
    return JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
  }
  return {};
}

// Save session
export function saveSession(session) {
  ensureConfigDir();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

// Check if config is valid
export function isConfigured() {
  const config = loadConfig();
  return !!(config.homeserver && config.user && config.password && config.recipient);
}

// Interactive setup wizard
export async function runSetupWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt, defaultValue = "") => {
    return new Promise((resolve) => {
      const displayPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
      rl.question(displayPrompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  };

  console.log("\n🔧 Jackpoint Setup Wizard\n");
  console.log("This wizard will configure your Matrix connection.\n");

  const config = loadConfig();

  const homeserver = await question("Matrix homeserver URL", config.homeserver || "https://matrix.org");
  const user = await question("Matrix username (e.g., @user:matrix.org)", config.user || "");
  const password = await question("Matrix password", "");
  const recipient = await question("Recipient user ID (who receives notifications)", config.recipient || "");

  rl.close();

  // Test connection
  console.log("\nTesting Matrix connection...");

  try {
    const tempClient = sdk.createClient({ baseUrl: homeserver });
    const response = await tempClient.login("m.login.password", {
      user: user,
      password: password,
    });

    console.log("✓ Login successful");

    // Save config
    const newConfig = {
      homeserver,
      user,
      password,
      recipient,
    };
    saveConfig(newConfig);

    // Save session with access token
    const session = loadSession();
    session.accessToken = response.access_token;
    session.userId = response.user_id;
    saveSession(session);

    console.log("✓ Session saved");
    console.log("\n✅ Configuration complete! Saved to ~/.jackpoint/\n");

    return newConfig;
  } catch (err) {
    console.error("\n❌ Connection failed:", err.message);
    console.error("   Please check your credentials and try again.\n");
    process.exit(1);
  }
}

// Get config values with defaults
export function getConfig() {
  const config = loadConfig();
  return {
    homeserver: config.homeserver || "https://matrix.org",
    user: config.user || "",
    password: config.password || "",
    recipient: config.recipient || "",
  };
}

export { CONFIG_DIR, CONFIG_FILE, SESSION_FILE };
