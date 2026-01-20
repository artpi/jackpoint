# Jackpoint

A bidirectional Matrix bridge for Claude Code. Get notifications on your phone when Claude needs input, and respond directly from Matrix.

## Why?

When running long Claude Code sessions, you don't want to babysit your terminal. Jackpoint sends you a Matrix DM when Claude:
- Asks a question
- Needs permission for a tool
- Stops and waits for input

You can respond from your phone, and the message gets injected back into the terminal.

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

## Requirements

- Node.js 18+
- tmux (for bidirectional communication)
- A Matrix account (e.g., on matrix.org)
- Claude Code CLI

## Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/jackpoint.git
cd jackpoint

# Install dependencies
npm install

# Link globally
npm link
```

## Setup

Run the setup wizard to configure your Matrix credentials:

```bash
jackpoint --setup
```

You'll be prompted for:
- Matrix homeserver URL (default: https://matrix.org)
- Your Matrix username
- Your Matrix password
- Recipient user ID (who receives notifications - usually yourself on mobile)

Credentials are stored in `~/.jackpoint/` (not in the repo).

## Usage

Start Claude Code with Matrix integration:

```bash
# Must be inside tmux
jackpoint claude
```

With arguments:

```bash
jackpoint claude --model sonnet
jackpoint claude --resume
```

### Matrix Commands

In your Matrix DM, you can use these commands:

| Command | Description |
|---------|-------------|
| `/lines [n]` | Show last n lines of terminal output (default: 30) |
| `/help` | Show available commands |

Any other message is sent directly to Claude as input.

### Debug Mode

```bash
MATRIX_DEBUG=1 jackpoint claude
```

## How It Works

1. **Wrapper Pattern**: `jackpoint claude` wraps Claude Code and injects hooks via `--settings` flag
2. **IPC Socket**: Hooks ping a Unix socket instead of doing Matrix I/O directly
3. **Matrix Listener**: Listens for incoming Matrix messages and injects them via `tmux send-keys`
4. **Session Persistence**: Matrix rooms persist by tmux pane (hostname:session:window.pane)

## Project Structure

```
├── claude-matrix.js      # Main CLI entry point
├── matrix-bridge.js      # Matrix API layer
├── matrix-listener.js    # Inbound message handler
└── lib/
    ├── config.js         # Configuration management
    ├── hook-injector.js  # Generates Claude hook settings
    ├── hook-ping.js      # Lightweight hook script
    ├── ipc-server.js     # Unix socket server
    └── silence-sdk.js    # Suppresses noisy SDK logs
```

## License

ISC
