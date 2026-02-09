import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 5000;
const JJ_TEMPLATE =
  'change_id.short(8) ++ " " ++ if(bookmarks, bookmarks ++ " ", "") ++ if(description, description.first_line(), "(no description)")';

/**
 * Patch built-in footer branch display to show jj status.
 *
 * Important: footer render paths must stay fast/non-blocking. We therefore:
 * - never run jj synchronously from getGitBranch()
 * - return cached status immediately
 * - refresh cache asynchronously in the background
 */
export default function (pi: ExtensionAPI) {
  let patched = false;
  let repoRoot: string | null = null;
  let cachedStatus: string | null = null;
  let refreshInFlight: Promise<void> | null = null;
  let lastRefreshAt = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function findJjRepoRoot(startCwd: string): string | null {
    let dir = resolve(startCwd);
    while (true) {
      if (existsSync(join(dir, ".jj"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!repoRoot) return;
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const { stdout } = await execFileAsync(
          "jj",
          ["log", "--no-graph", "-r", "@", "-T", JJ_TEMPLATE],
          { cwd: repoRoot, timeout: 3000, windowsHide: true },
        );
        cachedStatus = stdout.trim() || null;
      } catch {
        cachedStatus = null;
      } finally {
        lastRefreshAt = Date.now();
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  function scheduleStatusRefresh() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (!repoRoot) return;

    void refreshStatus();
    intervalId = setInterval(() => {
      void refreshStatus();
    }, REFRESH_MS);
    intervalId.unref?.();
  }

  function updateRepoContext(cwd: string) {
    const nextRoot = findJjRepoRoot(cwd);
    if (nextRoot !== repoRoot) {
      repoRoot = nextRoot;
      cachedStatus = null;
      lastRefreshAt = 0;
      scheduleStatusRefresh();
    }
  }

  function installFooterPatch(ctx: ExtensionContext) {
    if (!ctx.hasUI || patched) return;

    ctx.ui.setFooter((_tui, _theme, footerData) => {
      const original = footerData.getGitBranch.bind(footerData);

      (footerData as any).getGitBranch = () => {
        if (!repoRoot) return original();

        // Opportunistic stale refresh (async, non-blocking)
        if (Date.now() - lastRefreshAt > REFRESH_MS && !refreshInFlight) {
          void refreshStatus();
        }

        return cachedStatus ? `jj: ${cachedStatus}` : original();
      };

      patched = true;
      return { render: () => [""], invalidate() {} };
    });

    // Restore built-in footer (same provider instance now patched)
    ctx.ui.setFooter(undefined);
  }

  pi.on("session_start", async (_event, ctx) => {
    installFooterPatch(ctx);
    updateRepoContext(ctx.cwd);
  });

  pi.on("session_switch", async (_event, ctx) => {
    updateRepoContext(ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}
