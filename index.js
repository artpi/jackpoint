import sdk from "matrix-js-sdk";

// Configuration - replace with your values
const config = {
  baseUrl: "https://matrix.org",       // Your homeserver
  user: "@yourname:matrix.org",        // Your Matrix user ID
  password: "supersecret",             // Your password
  recipientUserId: "@friend:matrix.org" // Who to DM
};

async function main() {
  try {
    // Step 1: Create unauthenticated client and log in
    console.log("Logging in...");
    const tempClient = sdk.createClient({ baseUrl: config.baseUrl });

    const loginResponse = await tempClient.login("m.login.password", {
      user: config.user,
      password: config.password,
    });

    console.log("Logged in! User ID:", loginResponse.user_id);
    console.log("Access token:", loginResponse.access_token.slice(0, 20) + "...");

    // Step 2: Create authenticated client with the token
    const client = sdk.createClient({
      baseUrl: config.baseUrl,
      accessToken: loginResponse.access_token,
      userId: loginResponse.user_id,
    });

    // Step 3: Create or get existing DM room with the recipient
    console.log(`Creating/finding DM room with ${config.recipientUserId}...`);

    const dmRoom = await client.createRoom({
      preset: "trusted_private_chat",
      invite: [config.recipientUserId],
      is_direct: true,
    });

    const roomId = dmRoom.room_id;
    console.log("Room ID:", roomId);

    // Step 4: Send a message
    const message = "Hello from Node.js! This is a test DM.";
    console.log("Sending message...");

    await client.sendTextMessage(roomId, message);

    console.log("Message sent successfully!");

    // Optional: Store this for reuse
    console.log("\n--- Save these for future use (no login needed) ---");
    console.log(`Access Token: ${loginResponse.access_token}`);
    console.log(`User ID: ${loginResponse.user_id}`);

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    if (error.data) {
      console.error("Details:", JSON.stringify(error.data, null, 2));
    }
    process.exit(1);
  }
}

main();
