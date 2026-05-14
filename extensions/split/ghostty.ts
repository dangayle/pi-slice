// extensions/split/ghostty.ts
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import type { PaneManager } from "./pane-manager.js";

/**
 * Ghostty pane manager using Ghostty's native AppleScript API (macOS only).
 *
 * Ghostty exposes a rich scripting dictionary (Ghostty.sdef) with first-class
 * support for splits, terminal enumeration, focus, close, input text, and
 * performing keybind actions like `write_screen_file`.
 */

function osascript(script: string): string {
  return execSync("osascript -e " + shellEscape(script), {
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function appleEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The origin terminal ID — captured once at startup when pi IS the focused
 * terminal, then reused for all subsequent operations so we always target
 * the correct tab even if the user switches focus.
 *
 * Subagents inherit PI_SLICE_ORIGIN_PANE via env, so they never need to
 * call getCurrentPaneId() (which would resolve to the wrong terminal).
 */
let originTerminalId: string | null = process.env.PI_SLICE_ORIGIN_PANE || null;

export const ghosttyManager: PaneManager = {
  kind: "ghostty",

  getCurrentPaneId(): string {
    // If we already know our origin terminal (from a previous call or
    // inherited from a parent pi process), return it directly.
    if (originTerminalId) return originTerminalId;

    // First call — pi is the focused terminal right now, so this is safe.
    const id = osascript(`
tell application "Ghostty"
  tell front window
    tell selected tab
      return id of focused terminal
    end tell
  end tell
end tell`);

    // Cache it and export to env so subagents inherit it.
    originTerminalId = id;
    process.env.PI_SLICE_ORIGIN_PANE = id;
    return id;
  },

  splitVertical(cwd?: string): string {
    // Always split the origin terminal (where pi is running), not whatever
    // happens to be focused right now.
    const sourceId = originTerminalId || this.getCurrentPaneId();
    const safeSourceId = appleEscape(sourceId);

    if (cwd) {
      const safeCwd = appleEscape(cwd);
      return osascript(`
tell application "Ghostty"
  set cfg to new surface configuration
  set currentTerm to first terminal whose id is "${safeSourceId}"
  set newTerm to split currentTerm direction right with configuration cfg
  input text "cd ${safeCwd}" & return to newTerm
  return id of newTerm
end tell`);
    }

    return osascript(`
tell application "Ghostty"
  set currentTerm to first terminal whose id is "${safeSourceId}"
  set newTerm to split currentTerm direction right
  return id of newTerm
end tell`);
  },

  captureContent(paneId: string, lines: number): string | null {
    try {
      // Use perform action to write screen content to a temp file.
      // We save/restore the clipboard to avoid clobbering user data.
      const marker = `__pi_slice_${Date.now()}`;
      const markerFile = `/tmp/${marker}`;
      const safeId = appleEscape(paneId);

      // 1. Save current clipboard, trigger write_screen_file:copy,plain,
      //    read the path from clipboard, then restore clipboard.
      const filePath = osascript(`
tell application "Ghostty"
  set t to first terminal whose id is "${safeId}"

  -- Save current clipboard
  set oldClip to the clipboard as text

  -- Write screen to temp file and put path on clipboard
  perform action "write_screen_file:copy,plain" on t

  -- Grab the file path
  delay 0.1
  set filePath to the clipboard as text

  -- Restore clipboard
  set the clipboard to oldClip

  return filePath
end tell`);

      if (!filePath || !existsSync(filePath)) return null;

      const content = readFileSync(filePath, "utf-8");
      try { unlinkSync(filePath); } catch { /* ignore */ }

      // Trim trailing blank lines, then take last N lines
      const allLines = content.split("\n");
      let end = allLines.length;
      while (end > 0 && allLines[end - 1].trim() === "") end--;
      return allLines.slice(0, end).slice(-lines).join("\n");
    } catch {
      return null;
    }
  },

  sendKeys(paneId: string, command: string): void {
    const safeId = appleEscape(paneId);
    const safeCmd = appleEscape(command);
    osascript(`
tell application "Ghostty"
  set t to first terminal whose id is "${safeId}"
  input text "${safeCmd}" & return to t
end tell`);
  },

  isAlive(paneId: string): boolean {
    if (!paneId) return false;
    try {
      const result = osascript(`
tell application "Ghostty"
  try
    set t to first terminal whose id is "${appleEscape(paneId)}"
    return true
  on error
    return false
  end try
end tell`);
      return result === "true";
    } catch {
      return false;
    }
  },

  close(paneId: string): void {
    try {
      osascript(`
tell application "Ghostty"
  set t to first terminal whose id is "${appleEscape(paneId)}"
  close t
end tell`);
    } catch {
      // already closed
    }
  },

  focus(paneId: string): void {
    try {
      osascript(`
tell application "Ghostty"
  set t to first terminal whose id is "${appleEscape(paneId)}"
  focus t
end tell`);
    } catch {
      // ignore
    }
  },
};
