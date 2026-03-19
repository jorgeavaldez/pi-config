/**
 * Custom config and settings utilities.
 *
 * - Obsidian paths are loaded from obsidian.json
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ObsidianConfig {
  vaultPath?: string;
  promptsDir?: string;
  plansDir?: string;
}

interface RawObsidianConfig {
  vaultPath?: unknown;
  promptsDir?: unknown;
  plansDir?: unknown;
}

const DEFAULTS = {
  promptsDir: "~/.pi/prompts",
} as const;

function normalizeObsidianConfig(settings: RawObsidianConfig): ObsidianConfig {
  return {
    vaultPath: typeof settings.vaultPath === "string" ? settings.vaultPath : undefined,
    promptsDir: typeof settings.promptsDir === "string" ? settings.promptsDir : undefined,
    plansDir: typeof settings.plansDir === "string" ? settings.plansDir : undefined,
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

  const expandedVaultPath = merged.vaultPath ? expandTilde(merged.vaultPath) : undefined;

  return {
    vaultPath: expandedVaultPath,
    promptsDir: merged.promptsDir
      ? expandTilde(merged.promptsDir)
      : expandedVaultPath
        ? join(expandedVaultPath, "prompts")
        : undefined,
    plansDir: merged.plansDir
      ? expandTilde(merged.plansDir)
      : expandedVaultPath
        ? join(expandedVaultPath, "work", "plans")
        : undefined,
  };
}

/**
 * Get the prompts directory.
 *
 * Resolution order:
 * 1. promptsDir from obsidian.json
 * 2. vaultPath/prompts derived from obsidian.json
 * 3. ~/.pi/prompts fallback
 */
export function getPromptsDir(cwd: string): string {
  const config = loadObsidianConfig(cwd);
  return config.promptsDir ?? expandTilde(DEFAULTS.promptsDir);
}

/**
 * Get the plans directory, if configured.
 */
export function getPlansDir(cwd: string): string | undefined {
  return loadObsidianConfig(cwd).plansDir;
}

