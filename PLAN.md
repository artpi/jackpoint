# Claude Code Matrix Integration Plan

## Overview

A Matrix-based alternative interface for Claude Code that sends notifications to Matrix DMs when Claude needs input, with optional bidirectional communication.

## Architecture

```
┌─────────────────┐     hooks (stdout)      ┌──────────────────┐
│  Claude Code    │ ──────────────────────► │  Matrix Bridge   │
│  (terminal)     │                         │  (Node.js)       │
│                 │ ◄────────────────────── │                  │
└─────────────────┘   tmux send-keys        └──────────────────┘
                      (Phase 2 only)                ▲  │
                                                    │  ▼
                                              ┌──────────────┐
                                              │  Matrix DM   │
                                              │  (mobile)    │
                                              └──────────────┘
```

---

## Phase 1: Notifications (COMPLETED)

**Goal:** Send Claude's questions and status to Matrix DMs.

### Files Created

1. **`matrix-bridge.js`** - Main notification sender
   - Logs into Matrix using credentials from `.env`
   - Caches access token in `.matrix-session.json`
   - Finds/creates DM room with recipient
   - Sends formatted notifications

2. **`.claude/hooks/matrix-notify.js`** - Hook script
   - Receives JSON from stdin (Claude Code hook data)
   - Determines notification type (session start, question, stop)
   - Calls matrix-bridge to send to Matrix

3. **`.claude/settings.local.json`** - Hook configuration
   - `SessionStart` → notify session started
   - `PreToolUse` (AskUserQuestion) → send question + options
   - `Stop` → notify Claude is waiting for input

### How It Works

1. Claude Code fires hook on specific events
2. Hook script receives JSON via stdin with event data
3. Script calls matrix-bridge.js to send notification
4. User sees notification in Matrix DM on phone/desktop

### Limitations

- User must still respond in the terminal
- Matrix is notification-only (one-way)

---

## Phase 2: Bidirectional Communication (TODO)

**Goal:** Allow users to respond via Matrix DMs, with responses injected into Claude Code.

### Technical Approach

Based on research of existing projects (claude-slack, Claude-Code-Remote):

**Key Insight:** Hooks cannot inject responses back into Claude. The solution is to **bypass hooks** and use terminal I/O injection via tmux.

### Components to Add

1. **Matrix Listener Daemon**
   - Long-running process that listens for Matrix DM messages
   - Maps session_id to tmux session name
   - On message received: runs `tmux send-keys -t <session> "<message>" Enter`

2. **Session Management**
   - Track active Claude Code sessions
   - Map session_id → tmux session name → Matrix room

3. **Startup Script**
   - Start Claude Code in named tmux session: `tmux new -s claude`
   - Start matrix listener daemon in background

### Flow

**Outbound (Claude → Matrix):** Same as Phase 1

**Inbound (Matrix → Claude):**
1. User replies in Matrix DM
2. Listener daemon receives message
3. Daemon identifies which tmux session to target
4. Runs: `tmux send-keys -t claude "user response" Enter`
5. Claude receives input as if typed in terminal

### Requirements

- tmux (available on macOS via `brew install tmux`)
- User must start Claude Code inside tmux session
- Listener daemon must run in background

---

## Configuration

### Environment Variables (`.env`)

```
MATRIX_USER=@yourbot:matrix.org
MATRIX_PASS=yourpassword
MATRIX_RECIPIENT=@you:server.com
MATRIX_HOMESERVER=https://matrix.org
```

### Files Generated

- `.matrix-session.json` - Cached access token and room mappings (gitignored)

---

## Research References

### Existing Projects

1. **[Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote)**
   - Supports Email, Discord, Telegram
   - Uses PTY/tmux injection for bidirectional communication

2. **[claude-slack](https://github.com/dbenn8/claude-slack)**
   - Bidirectional Slack integration
   - Uses terminal input injection via socket listener

3. **[claude-code-slack-bot](https://github.com/mpociot/claude-code-slack-bot)**
   - Uses Claude Code SDK directly (not CLI)
   - Socket Mode for real-time Slack events

### Claude Code Hooks Documentation

- Hooks are event-driven shell commands
- Receive JSON via stdin, communicate via exit codes and stdout
- Available events: SessionStart, PreToolUse, PostToolUse, Stop, Notification, etc.
- Cannot inject user responses directly (one-way only)

---

## Usage

### Phase 1 (Current)

```bash
# Just run Claude Code normally in the project directory
cd /Users/artpi/GIT/clauder
claude

# Notifications will be sent to Matrix automatically
```

### Phase 2 (Future)

```bash
# Start listener daemon
node matrix-listener.js &

# Start Claude Code in tmux
tmux new -s claude
claude

# Now you can respond via Matrix DMs
```
