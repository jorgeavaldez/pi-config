/**
 * Editor environment bootstrap.
 *
 * Route external editing through the portable Neovim RPC client when installed.
 * Devices without the client keep their editor preference, defaulting to Neovim.
 */

import { existsSync, readFileSync } from "node:fs";
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

  // Installed clients can be Bash or JavaScript. Invoke the interpreter explicitly
  // rather than relying on Unix shebang execution (unavailable on Windows).
  const interpreter = /^#![^\r\n]*\bbash(?:\s|$)/.test(readFileSync(wrapperPath, "utf8")) ? "bash" : "node";
  const editor = `${interpreter} ${/[\s"'&|<>^()]/.test(wrapperPath) ? `"${wrapperPath}"` : wrapperPath}`;
  process.env.EDITOR = editor;
  process.env.VISUAL = editor;
}
