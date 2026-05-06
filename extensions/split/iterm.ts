// extensions/split/iterm.ts
import { execSync } from "node:child_process";
import type { PaneManager } from "./pane-manager.js";

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function osascript(script: string): string {
  return execSync("osascript -e " + shellEscape(script), {
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();
}

function appleEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Find a session by UUID and run an action. Returns result or null if not found.
 */
function withSession(sessionId: string, action: string): string | null {
  const script = `
tell application "iTerm2"
  repeat with w in windows
    tell w
      repeat with t in tabs
        tell t
          repeat with s in sessions
            tell s
              if unique ID is "${sessionId}" then
                ${action}
                return "OK"
              end if
            end tell
          end repeat
        end tell
      end repeat
    end tell
  end repeat
  return "NOT_FOUND"
end tell`;
  try {
    const result = osascript(script);
    return result === "NOT_FOUND" ? null : result;
  } catch {
    return null;
  }
}

export const itermManager: PaneManager = {
  kind: "iterm",

  getCurrentPaneId(): string {
    const envId = process.env.ITERM_SESSION_ID;
    if (envId) {
      const parts = envId.split(":");
      if (parts.length >= 2) return parts[1];
    }
    return osascript(`
tell application "iTerm2"
  tell current window
    tell current tab
      tell current session
        return unique ID
      end tell
    end tell
  end tell
end tell`);
  },

  splitVertical(cwd?: string): string {
    let cmdPart = "";
    if (cwd) {
      // Escape single quotes for the inner bash -c argument
      const safeCwd = cwd.replace(/'/g, "'\\''");
      const bashCmd = `bash -l -c 'cd ${safeCwd} && exec $SHELL -l'`;
      // Escape for AppleScript string (backslashes and double-quotes)
      cmdPart = `command "${appleEscape(bashCmd)}"`;
    }

    return osascript(`
tell application "iTerm2"
  tell current window
    tell current tab
      tell current session
        set newSession to (split vertically with default profile ${cmdPart})
        tell newSession
          set name to "shell"
          return unique ID
        end tell
      end tell
    end tell
  end tell
end tell`);
  },

  captureContent(paneId: string, lines: number): string | null {
    const result = withSession(paneId, "return contents");
    if (result === null || result === "OK") return null;
    // Take last N non-empty lines
    const allLines = result.split("\n");
    let end = allLines.length;
    while (end > 0 && allLines[end - 1].trim() === "") end--;
    return allLines.slice(0, end).slice(-lines).join("\n");
  },

  sendKeys(paneId: string, command: string): void {
    const safeCmd = appleEscape(command);
    withSession(paneId, `write text "${safeCmd}"`);
  },

  isAlive(paneId: string): boolean {
    if (!paneId) return false;
    const result = withSession(paneId, 'return "ALIVE"');
    return result === "ALIVE";
  },

  close(paneId: string): void {
    try {
      withSession(paneId, "close");
    } catch {
      // already closed
    }
  },

  focus(paneId: string): void {
    withSession(paneId, "select");
  },
};
