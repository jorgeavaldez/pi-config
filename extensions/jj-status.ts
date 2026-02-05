import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Monkeypatches footerData.getGitBranch() to show jj status instead of git branch.
 * The built-in footer renders `~/path (branch)` — we swap the value so it shows
 * `~/path (jj: changeId bookmark desc)`.
 * Falls back to original git branch when not in a jj repo.
 *
 * How: setFooter's factory gives us the footerDataProvider singleton. We patch
 * getGitBranch on it, then immediately restore the built-in footer. The built-in
 * footer uses the same provider object, so it picks up our patch.
 */
export default function (pi: ExtensionAPI) {
  let patched = false;

  function isJjRepo(): boolean {
    let dir = process.cwd();
    while (true) {
      if (existsSync(join(dir, ".jj"))) return true;
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }

  function getJjStatus(): string | null {
    if (!isJjRepo()) return null;
    try {
      return execSync(
        `jj log --no-graph -r @ -T 'change_id.short(8) ++ " " ++ if(bookmarks, bookmarks ++ " ", "") ++ if(description, description.first_line(), "(no description)")'`,
        { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim() || null;
    } catch {
      return null;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || patched) return;

    // Briefly set a custom footer just to grab the footerDataProvider reference
    ctx.ui.setFooter((_tui, _theme, footerData) => {
      // Patch the singleton
      const original = footerData.getGitBranch.bind(footerData);
      (footerData as any).getGitBranch = () => {
        const jj = getJjStatus();
        return jj ? `jj: ${jj}` : original();
      };
      patched = true;

      // Return minimal component — gets replaced immediately below
      return { render: () => [""], invalidate() {} };
    });

    // Restore built-in footer — it uses the same (now patched) footerDataProvider
    ctx.ui.setFooter(undefined);
  });
}
