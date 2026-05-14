// extensions/split/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPaneManager, type PaneManager } from "./pane-manager.js";

// ---------------------------------------------------------------------------
// File-based lock so only one companion pane is created across all pi
// processes (root + subagents) within the same terminal session.
// ---------------------------------------------------------------------------

const LOCK_DIR = join(tmpdir(), "pi-slice");

function lockFilePath(manager: PaneManager): string {
  // Key the lock to the terminal session so different tmux/zellij sessions
  // can each have their own companion pane.
  let sessionKey = "default";
  if (manager.kind === "tmux" && process.env.TMUX) {
    // TMUX env looks like "/tmp/tmux-501/default,12345,0" — use the socket path + server pid
    sessionKey = process.env.TMUX.replace(/[^a-zA-Z0-9]/g, "_");
  } else if (manager.kind === "zellij" && process.env.ZELLIJ_SESSION_NAME) {
    sessionKey = process.env.ZELLIJ_SESSION_NAME;
  } else if (manager.kind === "iterm" && process.env.ITERM_SESSION_ID) {
    // Use just the window/tab portion, not the pane-specific part
    sessionKey = process.env.ITERM_SESSION_ID.split(":").slice(0, 2).join("_");
  } else if (manager.kind === "ghostty") {
    // Use the origin terminal ID so each tab gets its own lock.
    // Falls back to env var (subagents inherit it) or a generic key.
    sessionKey = process.env.PI_SLICE_ORIGIN_PANE || "ghostty";
  }
  return join(LOCK_DIR, `companion-${manager.kind}-${sessionKey}.lock`);
}

function readLockFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function writeLockFile(path: string, paneId: string): void {
  try {
    mkdirSync(LOCK_DIR, { recursive: true });
    writeFileSync(path, paneId, "utf-8");
  } catch {
    // best-effort
  }
}

function removeLockFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

export default function (pi: ExtensionAPI) {
  const paneManager: PaneManager | null = detectPaneManager();

  let piPaneId: string | null = null;
  let companionPaneId: string | null = null;
  let isOwner = false; // true only for the process that created the pane

  // -------------------------------------------------------------------------
  // Core split logic
  // -------------------------------------------------------------------------

  function doSplit(cwd: string): { ok: true } | { ok: false; reason: string } {
    if (!paneManager) {
      return { ok: false, reason: "No supported terminal detected (need tmux, zellij, iTerm2, or Ghostty)." };
    }
    if (companionPaneId && paneManager.isAlive(companionPaneId)) {
      return { ok: false, reason: "Companion pane already exists." };
    }
    try {
      piPaneId = paneManager.getCurrentPaneId();
      companionPaneId = paneManager.splitVertical(cwd);
      paneManager.focus(piPaneId);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Split failed: ${msg}` };
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    if (!paneManager) return;

    // For Ghostty: eagerly resolve the origin terminal ID while we're
    // still the focused terminal (before the user switches tabs).
    piPaneId = paneManager.getCurrentPaneId();

    // Fast path for subagents: if the parent already set the companion
    // pane ID in the environment, just reuse it.
    const envCompanion = process.env.PI_SLICE_COMPANION_PANE;
    if (envCompanion && paneManager.isAlive(envCompanion)) {
      companionPaneId = envCompanion;
      isOwner = false;
      return;
    }

    const lockPath = lockFilePath(paneManager);

    // Check if another pi process already owns a live companion pane.
    const existingPaneId = readLockFile(lockPath);
    if (existingPaneId && paneManager.isAlive(existingPaneId)) {
      // Reuse the existing pane — don't split a new one.
      companionPaneId = existingPaneId;
      isOwner = false;
      return;
    }

    if (companionPaneId && paneManager.isAlive(companionPaneId)) return;

    const result = doSplit(ctx.cwd);
    if (result.ok) {
      isOwner = true;
      writeLockFile(lockPath, companionPaneId!);
      // Export companion pane ID so subagents inherit it directly.
      process.env.PI_SLICE_COMPANION_PANE = companionPaneId!;
      ctx.ui.notify("🪟 Companion pane opened", "info");
    }
  });

  pi.on("session_shutdown", async () => {
    // Only the process that created the pane should close it.
    if (paneManager && companionPaneId && isOwner && paneManager.isAlive(companionPaneId)) {
      paneManager.close(companionPaneId);
      removeLockFile(lockFilePath(paneManager));
      companionPaneId = null;
    }
  });

  // -------------------------------------------------------------------------
  // Slash commands
  // -------------------------------------------------------------------------

  pi.registerCommand("split", {
    description: "Open a companion shell pane (or reopen if closed)",
    handler: async (_args, ctx) => {
      const result = doSplit(ctx.cwd);
      if (result.ok) {
        ctx.ui.notify("🪟 Companion pane opened", "success");
      } else {
        ctx.ui.notify(result.reason, "warning");
      }
    },
  });

  pi.registerCommand("unsplit", {
    description: "Close the companion shell pane",
    handler: async (_args, ctx) => {
      if (!paneManager || !companionPaneId || !paneManager.isAlive(companionPaneId)) {
        ctx.ui.notify("No companion pane to close.", "warning");
        return;
      }
      paneManager.close(companionPaneId);
      companionPaneId = null;
      ctx.ui.notify("🪟 Companion pane closed", "info");
    },
  });

  // -------------------------------------------------------------------------
  // LLM-callable tools
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "pane_read",
    label: "Read Companion Pane",
    description:
      "Read the last N lines of output from the companion terminal pane. " +
      "Use this to see command output, logs, or server status in the other pane.",
    promptSnippet: "Read output from the companion terminal pane (the 'slice')",
    promptGuidelines: [
      "pi-slice provides a companion terminal pane (aka 'the slice', 'the pane', 'the other pane', 'the terminal'). When the user refers to running something 'in the slice', 'in the pane', or 'in the terminal', use pane_exec and pane_read.",
      "Use pane_read to check the companion pane's output (e.g. dev server logs, test results).",
      "Use pane_read after pane_exec to see the result of a command sent to the companion pane.",
    ],
    parameters: Type.Object({
      lines: Type.Optional(
        Type.Number({ description: "Number of lines to capture (default: 50)", default: 50 })
      ),
    }),
    async execute(_toolCallId, params) {
      if (!paneManager || !companionPaneId) {
        return {
          content: [{ type: "text", text: "No companion pane is open. Use /split to create one." }],
          details: {},
          isError: true,
        };
      }
      if (!paneManager.isAlive(companionPaneId)) {
        companionPaneId = null;
        return {
          content: [{ type: "text", text: "Companion pane has been closed." }],
          details: {},
          isError: true,
        };
      }
      const lines = params.lines ?? 50;
      const content = paneManager.captureContent(companionPaneId, lines);
      if (content === null) {
        return {
          content: [{ type: "text", text: "Failed to capture pane content." }],
          details: {},
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: content }],
        details: { lines_captured: content.split("\n").length },
      };
    },
  });

  pi.registerTool({
    name: "pane_exec",
    label: "Run in Companion Pane",
    description:
      "Send a command to the companion terminal pane (like typing it and pressing Enter). " +
      "Use this to run dev servers, tests, or any command in the companion shell. " +
      "The command runs in the companion pane's current directory.",
    promptSnippet: "Send a command to the companion terminal pane (the 'slice')",
    promptGuidelines: [
      "Use pane_exec to run long-lived processes (dev servers, watchers) in the companion pane instead of bash.",
      "After pane_exec, use pane_read to check the output if needed.",
      "Do NOT use pane_exec for commands where you need the exit code — use bash for those.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute in the companion pane" }),
    }),
    async execute(_toolCallId, params) {
      if (!paneManager || !companionPaneId) {
        return {
          content: [{ type: "text", text: "No companion pane is open. Use /split to create one." }],
          details: {},
          isError: true,
        };
      }
      if (!paneManager.isAlive(companionPaneId)) {
        companionPaneId = null;
        return {
          content: [{ type: "text", text: "Companion pane has been closed." }],
          details: {},
          isError: true,
        };
      }
      try {
        paneManager.sendKeys(companionPaneId, params.command);
        return {
          content: [{ type: "text", text: `Sent to companion pane: ${params.command}` }],
          details: { command: params.command },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to send command: ${msg}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
