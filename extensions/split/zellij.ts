// extensions/split/zellij.ts
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import type { PaneManager } from "./pane-manager.js";

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\'") + "'";
}

function zellij(cmd: string): string {
  return execSync(`zellij ${cmd}`, { encoding: "utf-8", timeout: 10_000 }).trim();
}

export const zellijManager: PaneManager = {
  kind: "zellij",

  getCurrentPaneId(): string {
    // Zellij sets ZELLIJ_PANE_ID in newer versions
    if (process.env.ZELLIJ_PANE_ID) return process.env.ZELLIJ_PANE_ID;
    // Fallback: use "focused" as a reference
    return "focused";
  },

  splitVertical(cwd?: string): string {
    const cdArg = cwd ? `--cwd ${shellEscape(cwd)}` : "";
    // Open a new pane to the right
    zellij(`action new-pane --direction right ${cdArg}`);
    // Move focus back to the left (pi) pane
    zellij("action focus-previous-pane");
    return "right";
  },

  captureContent(_paneId: string, lines: number): string | null {
    // Zellij doesn't have native pane capture like tmux.
    // Use the scrollback dump workaround:
    try {
      const tmpFile = `/tmp/pi-split-capture-${Date.now()}.txt`;
      // Focus companion, dump, then focus back
      zellij("action focus-next-pane");
      zellij(`action dump-screen ${shellEscape(tmpFile)}`);
      zellij("action focus-previous-pane");
      const content = readFileSync(tmpFile, "utf-8");
      unlinkSync(tmpFile);
      const allLines = content.split("\n");
      let end = allLines.length;
      while (end > 0 && allLines[end - 1].trim() === "") end--;
      return allLines.slice(0, end).slice(-lines).join("\n");
    } catch {
      return null;
    }
  },

  sendKeys(_paneId: string, command: string): void {
    // Focus the companion pane, write, then focus back
    zellij("action focus-next-pane");
    zellij(`action write-chars ${shellEscape(command)}`);
    zellij("action write 10"); // Enter key (newline byte)
    zellij("action focus-previous-pane");
  },

  isAlive(_paneId: string): boolean {
    // Check if we still have more than one pane in the current tab
    try {
      const output = zellij("action dump-layout");
      // If there are multiple pane references, companion is alive
      const paneCount = (output.match(/pane/gi) || []).length;
      return paneCount > 1;
    } catch {
      return false;
    }
  },

  close(_paneId: string): void {
    try {
      zellij("action focus-next-pane");
      zellij("action close-pane");
    } catch {
      // already closed
    }
  },

  focus(_paneId: string): void {
    // No-op — we manage focus in sendKeys/captureContent
  },
};
