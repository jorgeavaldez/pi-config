/**
 * Editor environment bootstrap.
 *
 * Route external editing through the portable Neovim RPC client when installed.
 * Devices without the client keep their editor preference, defaulting to Neovim.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default function editorEnvExtension() {
  const configHomes = [
    process.env.XDG_CONFIG_HOME,
    ...(process.platform === "win32" ? [process.env.LOCALAPPDATA] : []),
    join(homedir(), ".config"),
  ];
  const appName = process.env.NVIM_APPNAME || "nvim";
  const wrapperPath = configHomes
    .filter((path): path is string => Boolean(path))
    .map((path) => join(path, appName, "bin", "pi-nvim-editor"))
    .find((path) => existsSync(path));

  if (!wrapperPath) {
    // Some devices only have local Neovim, without the RPC integration.
    process.env.EDITOR ||= process.env.VISUAL || "nvim";
    process.env.VISUAL ||= process.env.EDITOR;
    return;
  }

  // Invoke Node explicitly: Windows cannot execute Unix shebang scripts.
  // Quoting keeps config paths containing spaces intact for editor consumers.
  const editor = `node ${/[\s"'&|<>^()]/.test(wrapperPath) ? `"${wrapperPath}"` : wrapperPath}`;
  process.env.EDITOR = editor;
  process.env.VISUAL = editor;
}
