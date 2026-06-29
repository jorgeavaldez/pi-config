/**
 * Custom config and settings utilities.
 *
 * - Obsidian vault path is loaded from obsidian.json
 */

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ObsidianConfig {
  vaultPath?: string;
}

interface RawObsidianConfig {
  vaultPath?: unknown;
}

function normalizeObsidianConfig(settings: RawObsidianConfig): ObsidianConfig {
  return {
    vaultPath: typeof settings.vaultPath === "string" ? settings.vaultPath : undefined,
  };
}

/**
 * Expand ~ to home directory.
 */
export function expandTilde(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Load Obsidian config with project-over-global precedence.
 *
 * Supported files:
 * - user agent config dir/obsidian.json
 * - <cwd>/<config dir>/obsidian.json
 */
function loadObsidianConfig(cwd: string): ObsidianConfig {
  const globalConfig = normalizeObsidianConfig(
    readJsonFile<RawObsidianConfig>(join(homedir(), CONFIG_DIR_NAME, "agent", "obsidian.json")) ?? {},
  );
  const projectConfig = normalizeObsidianConfig(
    readJsonFile<RawObsidianConfig>(join(cwd, CONFIG_DIR_NAME, "obsidian.json")) ?? {},
  );

  const merged: ObsidianConfig = {
    ...globalConfig,
    ...projectConfig,
  };

  return {
    vaultPath: merged.vaultPath ? expandTilde(merged.vaultPath) : undefined,
  };
}

/**
 * Get the prompts directory.
 *
 * Resolution order:
 * 1. vaultPath/prompts derived from obsidian.json
 * 2. user config dir/prompts fallback
 */
export function getPromptsDir(cwd: string): string {
  const config = loadObsidianConfig(cwd);
  return config.vaultPath ? join(config.vaultPath, "prompts") : join(homedir(), CONFIG_DIR_NAME, "prompts");
}

