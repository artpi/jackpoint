# Jackpoint - Matrix Bridge for Claude Code

A bidirectional Matrix integration for Claude Code that sends notifications to Matrix DMs when Claude needs input, and allows responding via Matrix messages.

## Architecture

```
┌─────────────────┐     hooks (IPC)         ┌──────────────────┐
│  Claude Code    │ ──────────────────────► │  Jackpoint       │
│  (terminal)     │                         │  (Node.js)       │
│                 │ ◄────────────────────── │                  │
└─────────────────┘   tmux send-keys        └──────────────────┘
                                                   ▲  │
                                                   │  ▼
                                             ┌──────────────┐
                                             │  Matrix DM   │
                                             │  (mobile)    │
                                             └──────────────┘
```

### How It Works

1. **Wrapper Pattern**: `jackpoint claude` wraps Claude Code and injects hooks via `--settings` flag
2. **IPC Socket**: Hooks ping a Unix socket instead of doing Matrix I/O directly
3. **Matrix Listener**: Listens for incoming Matrix messages and injects them via `tmux send-keys`
4. **Session Persistence**: Matrix rooms persist by tmux pane (hostname:session:window.pane)

## Files

### Main Entry Points

- **`claude-matrix.js`** - Main wrapper script (`jackpoint` CLI)
  - Spawns Claude Code with injected hook settings
  - Starts IPC server for hook events
  - Starts Matrix listener for bidirectional communication
  - Handles hook events and sends Matrix notifications

- **`matrix-bridge.js`** - Matrix API layer
  - Authentication with token caching
  - Room creation/persistence by session key
  - Formatted notification sending
  - Typing indicators

- **`matrix-listener.js`** - Inbound message handler
  - Syncs with Matrix and listens for new messages
  - Maps rooms back to tmux targets
  - Injects messages via `tmux send-keys`

### Library Files (`lib/`)

- **`hook-injector.js`** - Generates Claude Code hook settings JSON
  - Creates hook config pointing to IPC socket
  - Supports SessionStart, PreToolUse (AskUserQuestion + Bash/Edit/Write/NotebookEdit), Stop, Notification events

- **`hook-ping.js`** - Lightweight hook script
  - Reads hook JSON from stdin
  - Forwards to wrapper's Unix socket
  - Zero external dependencies

- **`ipc-server.js`** - Unix socket server
  - Receives hook payloads from hook-ping.js
  - Emits events to main wrapper

- **`config.js`** - Configuration management
  - Stores config in `~/.jackpoint/config.json`
  - Stores session tokens in `~/.jackpoint/session.json`
  - Interactive setup wizard

- **`silence-sdk.js`** - Patches matrix-js-sdk to suppress noisy logs

### Legacy/Other

- **`.claude/hooks/matrix-notify.js`** - Old project-local hook (deprecated)
- **`index.js`**, **`send-dm.js`** - Standalone Matrix utilities

## Configuration

Config stored in `~/.jackpoint/`:

```
~/.jackpoint/
├── config.json      # Matrix credentials
└── session.json     # Access token + room mappings
```

Run `jackpoint --setup` to configure.

## Hook Events

The wrapper listens for these Claude Code hook events:

| Event | Trigger | Matrix Notification |
|-------|---------|---------------------|
| `SessionStart` | New session starts | Creates/reuses room, sends session info |
| `PreToolUse` | Before tool execution | AskUserQuestion: sends questions; Bash/Edit/Write: sends permission request |
| `Stop` | Claude stops/waits | Sends last message, clears typing |
| `Notification` | Various notifications | Handles idle_prompt |

## Usage

```bash
# Run setup wizard
jackpoint --setup

# Start Claude Code with Matrix integration
jackpoint claude

# With arguments
jackpoint claude --model sonnet

# Debug mode
MATRIX_DEBUG=1 jackpoint claude
```

Requires running inside tmux for bidirectional communication.

## Matrix Commands

Send these commands in the Matrix DM to interact with the terminal:

| Command | Description |
|---------|-------------|
| `/lines [n]` | Show last n lines of terminal output (default: 30) |
| `/help` | Show available commands |

Any other message is sent directly to the Claude Code terminal as input.

## Development

```bash
# Install dependencies
npm install

# Debug mode shows hook events and Matrix activity
MATRIX_DEBUG=1 jackpoint claude
```
