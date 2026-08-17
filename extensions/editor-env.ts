/**
 * Editor environment bootstrap.
 *
 * If the Neovim RPC wrapper exists, force EDITOR/VISUAL to that wrapper so all
 * external-editor calls in this Pi process use the deterministic host-aware flow.
 */

import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function resolveWrapperPath(): string | null {
  const configHome = process.env.XDG_CONFIG_HOME;
  if (configHome && configHome.length > 0) {
    return join(configHome, "nvim", "bin", "pi-nvim-editor");
  }

  const home = process.env.HOME;
  if (!home || home.length === 0) {
    return null;
  }

  return join(home, ".config", "nvim", "bin", "pi-nvim-editor");
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export default function editorEnvExtension(_pi: ExtensionAPI) {
  const wrapperPath = resolveWrapperPath();

  if (!wrapperPath) {
    console.warn("editor-env: HOME is not set; cannot resolve pi-nvim-editor path. Leaving EDITOR/VISUAL unchanged.");
    return;
  }

  if (!isExecutable(wrapperPath)) {
    // The Neovim RPC wrapper is optional on Android, where a local editor is used.
    if (process.platform !== "android") {
      console.warn(
        `editor-env: wrapper not found or not executable at ${wrapperPath}. Leaving EDITOR/VISUAL unchanged.`
      );
    }
    return;
  }

  // Process-wide side effect: all subprocesses spawned from this Pi process will
  // inherit these env vars and therefore use the wrapper too.
  process.env.EDITOR = wrapperPath;
  process.env.VISUAL = wrapperPath;
}
