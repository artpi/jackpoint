#!/usr/bin/env node
import sdk from "matrix-js-sdk";

/**
 * Matrix DM sender - minimal CLI tool
 *
 * Usage:
 *   MATRIX_USER=@you:server MATRIX_PASS=secret node send-dm.js @friend:server "Hello!"
 *
 * Or with stored token:
 *   MATRIX_TOKEN=syt_xxx MATRIX_USER=@you:server node send-dm.js @friend:server "Hello!"
 */

const baseUrl = process.env.MATRIX_HOMESERVER || "https://matrix.org";
const userId = process.env.MATRIX_USER;
const password = process.env.MATRIX_PASS;
const accessToken = process.env.MATRIX_TOKEN;

const [recipient, ...messageParts] = process.argv.slice(2);
const message = messageParts.join(" ") || "Hello from matrix-cli!";

if (!recipient) {
  console.error("Usage: node send-dm.js @recipient:server \"message\"");
  console.error("\nRequired env vars:");
  console.error("  MATRIX_USER       Your Matrix user ID (@you:server)");
  console.error("  MATRIX_PASS       Your password (for login)");
  console.error("  OR MATRIX_TOKEN   Access token (if already logged in)");
  console.error("\nOptional:");
  console.error("  MATRIX_HOMESERVER Homeserver URL (default: https://matrix.org)");
  process.exit(1);
}

async function getClient() {
  // If we have a token, use it directly
  if (accessToken && userId) {
    console.log("Using stored access token...");
    return sdk.createClient({
      baseUrl,
      accessToken,
      userId,
    });
  }

  // Otherwise, log in with password
  if (!userId || !password) {
    throw new Error("Need MATRIX_USER + MATRIX_PASS or MATRIX_USER + MATRIX_TOKEN");
  }

  console.log(`Logging in as ${userId}...`);
  const tempClient = sdk.createClient({ baseUrl });

  const response = await tempClient.login("m.login.password", {
    user: userId,
    password,
  });

  console.log("Logged in!");
  console.log(`Save this token for future use: MATRIX_TOKEN=${response.access_token}`);

  return sdk.createClient({
    baseUrl,
    accessToken: response.access_token,
    userId: response.user_id,
  });
}

async function sendDM(client, recipientId, text) {
  // Create or get DM room
  console.log(`Opening DM with ${recipientId}...`);

  const room = await client.createRoom({
    preset: "trusted_private_chat",
    invite: [recipientId],
    is_direct: true,
  });

  // Send message
  await client.sendTextMessage(room.room_id, text);
  console.log(`Sent: "${text}"`);

  return room.room_id;
}

async function main() {
  try {
    const client = await getClient();
    await sendDM(client, recipient, message);
    console.log("Done!");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
