import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

/**
 * Shows Jujutsu (jj) status in the footer instead of (or alongside) git info.
 * Displays: change ID, bookmark(s), and working copy description.
 * Updates on tool_result events (file changes) and session_start.
 */
export default function (pi: ExtensionAPI) {
  const STATUS_KEY = "jj";
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function getJjStatus(): string | null {
    try {
      const result = execSync(
        `jj log --no-graph -r @ -T 'change_id.short(8) ++ " " ++ if(bookmarks, bookmarks ++ " ", "") ++ if(description, description.first_line(), "(no description)")'`,
        { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  function updateStatus(ctx: { ui: { setStatus: (key: string, text: string | undefined) => void }; hasUI: boolean }) {
    if (!ctx.hasUI) return;
    const status = getJjStatus();
    if (status) {
      ctx.ui.setStatus(STATUS_KEY, `jj: ${status}`);
    } else {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  }

  // Set initial status on session start
  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);

    // Poll every 5s to catch external changes (jj operations from other terminals)
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => updateStatus(ctx), 5000);
  });

  // Update after tool executions that might change files
  pi.on("tool_result", async (event, ctx) => {
    if (["bash", "write", "edit"].includes(event.toolName)) {
      updateStatus(ctx);
    }
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
}
