/**
 * Custom config and settings utilities.
 *
 * - Obsidian vault path is loaded from obsidian.json
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ObsidianConfig {
  vaultPath?: string;
}

interface RawObsidianConfig {
  vaultPath?: unknown;
}

const DEFAULTS = {
  promptsDir: "~/.pi/prompts",
} as const;

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
 * - ~/.pi/agent/obsidian.json
 * - <cwd>/.pi/obsidian.json
 */
function loadObsidianConfig(cwd: string): ObsidianConfig {
  const globalConfig = normalizeObsidianConfig(
    readJsonFile<RawObsidianConfig>(join(homedir(), ".pi", "agent", "obsidian.json")) ?? {},
  );
  const projectConfig = normalizeObsidianConfig(
    readJsonFile<RawObsidianConfig>(join(cwd, ".pi", "obsidian.json")) ?? {},
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
 * 2. ~/.pi/prompts fallback
 */
export function getPromptsDir(cwd: string): string {
  const config = loadObsidianConfig(cwd);
  return config.vaultPath ? join(config.vaultPath, "prompts") : expandTilde(DEFAULTS.promptsDir);
}

