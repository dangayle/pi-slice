// extensions/split/tmux.ts
import { execSync } from "node:child_process";
import type { PaneManager } from "./pane-manager.js";

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\'") + "'";
}

function tmux(cmd: string): string {
  return execSync(`tmux ${cmd}`, { encoding: "utf-8", timeout: 10_000 }).trim();
}

export const tmuxManager: PaneManager = {
  kind: "tmux",

  getCurrentPaneId(): string {
    if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
    return tmux("display-message -p '#{pane_id}'");
  },

  splitVertical(cwd?: string, sourcePaneId?: string): string {
    const cdFlag = cwd ? `-c ${shellEscape(cwd)}` : "";
    // Target the specific pane so the split happens in the right window/tab
    // even if the user switched focus.
    const targetFlag = sourcePaneId ? `-t ${sourcePaneId}` : "";
    return tmux(`split-window -h -d -l 50% ${targetFlag} ${cdFlag} -P -F '#{pane_id}'`);
  },

  captureContent(paneId: string, lines: number): string | null {
    try {
      return tmux(`capture-pane -t ${paneId} -p -S -${lines}`);
    } catch {
      return null;
    }
  },

  sendKeys(paneId: string, command: string): void {
    tmux(`send-keys -t ${paneId} ${shellEscape(command)} Enter`);
  },

  isAlive(paneId: string): boolean {
    if (!paneId) return false;
    try {
      const out = tmux("list-panes -a -F '#{pane_id} #{pane_dead}'");
      for (const line of out.split("\n")) {
        const [id, dead] = line.split(" ");
        if (id === paneId) return dead === "0";
      }
      return false;
    } catch {
      return false;
    }
  },

  close(paneId: string): void {
    try {
      tmux(`kill-pane -t ${paneId}`);
    } catch {
      // already dead
    }
  },

  focus(paneId: string): void {
    try {
      tmux(`select-pane -t ${paneId}`);
    } catch {
      // ignore
    }
  },
};
