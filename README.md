# pi-slice 🍕

Auto-split your terminal when [pi](https://github.com/mariozechner/pi-coding-agent) starts, giving the agent a companion pane it can read from and write to.

Supports **tmux**, **zellij**, and **iTerm2**.

## What it does

When pi launches, pi-slice splits your terminal vertically and exposes two tools to the agent:

| Tool | Description |
|------|-------------|
| `pane_exec` | Send a command to the companion pane (runs it like typing + Enter) |
| `pane_read` | Read the last N lines of output from the companion pane |

This lets the agent run dev servers, watch logs, execute tests, and read their output — all without blocking the main conversation.

## Install

```bash
pi package install dangayle/pi-slice
```

Or add it manually to your pi config:

```json
{
  "packages": ["dangayle/pi-slice"]
}
```

## Terminal support

| Terminal | Method |
|----------|--------|
| **tmux** | `split-window`, `send-keys`, `capture-pane` |
| **zellij** | `action new-pane`, `action write`, `action dump-screen` |
| **iTerm2** | AppleScript (`split vertically with default profile`) |

The pane manager is auto-detected at startup. If none of the above are found, pi-slice will log a warning and the tools won't be registered.

## License

MIT
