# pi-slice 🍕

A [pi](https://github.com/mariozechner/pi-coding-agent) package that auto-splits your terminal when pi starts, so you don't have to manually open a second pane every time you need a dev server, file watcher, or anything else running alongside pi.

If you're like me, you're always splitting your iTerm window vertically to run `vite dev` or `next dev` with HMR while working in pi. pi-slice does that automatically and gives the agent tools to interact with it.

Supports **tmux**, **zellij**, **iTerm2**, and **Ghostty**.

## What it does

On startup, pi-slice splits your terminal vertically and registers two tools:

| Tool | Description |
|------|-------------|
| `pane_exec` | Send a command to the companion pane (like typing + Enter) |
| `pane_read` | Read the last N lines of output from the companion pane |

The agent knows the companion pane as "the slice" — so you can say things like _"start the dev server in the slice"_ or _"check the slice for errors"_ and it just works.

## Install

```bash
pi install https://github.com/dangayle/pi-slice
```

## Usage

pi-slice splits automatically when pi starts. No setup needed.

You can also control it manually:

- `/split` — reopen the companion pane if closed
- `/unsplit` — close it

## Terminal support

| Terminal | Method |
|----------|--------|
| **tmux** | `split-window`, `send-keys`, `capture-pane` |
| **zellij** | `action new-pane`, `action write`, `action dump-screen` |
| **iTerm2** | AppleScript (`split vertically with default profile`) |
| **Ghostty** | Native AppleScript API (`split`, `input text`, `write_screen_file`) |

Auto-detected at startup. If none are found, the tools won't register.

## License

MIT
