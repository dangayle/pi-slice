// extensions/split/pane-manager.ts

export interface PaneManager {
  /** Which backend is active. */
  readonly kind: "tmux" | "iterm" | "zellij" | "ghostty";

  /** Get the current pane/session ID (where pi is running). */
  getCurrentPaneId(): string;

  /**
   * Split the current pane vertically (new pane to the right).
   * Optionally start in the given cwd.
   * Returns the new pane's ID.
   */
  splitVertical(cwd?: string): string;

  /** Capture the last N lines of content from a pane. */
  captureContent(paneId: string, lines: number): string | null;

  /** Send a command string to a pane (like typing + Enter). */
  sendKeys(paneId: string, command: string): void;

  /** Check whether a pane is still alive. */
  isAlive(paneId: string): boolean;

  /** Close/kill a pane. */
  close(paneId: string): void;

  /** Focus back on a specific pane. */
  focus(paneId: string): void;
}

export function isInTmux(): boolean {
  return !!process.env.TMUX;
}

export function isInZellij(): boolean {
  return !!process.env.ZELLIJ;
}

export function isInGhostty(): boolean {
  if (process.env.TMUX || process.env.ZELLIJ) return false;
  return (
    process.env.TERM_PROGRAM === "ghostty" ||
    !!process.env.GHOSTTY_RESOURCES_DIR
  );
}

export function isInITerm(): boolean {
  if (process.env.TMUX || process.env.ZELLIJ) return false;
  return !!(
    process.env.ITERM_SESSION_ID ||
    process.env.TERM_PROGRAM?.toLowerCase() === "iterm.app"
  );
}

/**
 * Auto-detect the terminal environment and return the appropriate backend.
 * Returns null if no supported terminal is detected.
 */
export function detectPaneManager(): PaneManager | null {
  // Use require() for synchronous loading — jiti handles .ts resolution
  const req = typeof require !== "undefined" ? require : undefined;
  if (!req) return null;

  if (isInTmux()) {
    const { tmuxManager } = req("./tmux.js");
    return tmuxManager;
  }
  if (isInZellij()) {
    const { zellijManager } = req("./zellij.js");
    return zellijManager;
  }
  if (isInGhostty()) {
    const { ghosttyManager } = req("./ghostty.js");
    return ghosttyManager;
  }
  if (isInITerm()) {
    const { itermManager } = req("./iterm.js");
    return itermManager;
  }
  return null;
}
