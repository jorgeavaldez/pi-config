/**
 * Custom Settings Utilities
 *
 * Reads custom extension settings from scoped SettingsManager settings
 * (project + global) with project-over-global precedence.
 */

import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

interface CustomSettings {
  promptsDir?: string;
  exaMcpEndpoint?: string;
}

interface RawCustomSettings {
  promptsDir?: unknown;
  exaMcpEndpoint?: unknown;
}

// Sensible defaults
const DEFAULTS: Required<CustomSettings> = {
  promptsDir: "~/.pi/prompts",
  exaMcpEndpoint: "https://mcp.exa.ai/mcp",
};

function normalizeCustomSettings(settings: RawCustomSettings): CustomSettings {
  return {
    promptsDir: typeof settings.promptsDir === "string" ? settings.promptsDir : undefined,
    exaMcpEndpoint: typeof settings.exaMcpEndpoint === "string" ? settings.exaMcpEndpoint : undefined,
  };
}

/**
 * Expand ~ to home directory
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

/**
 * Load custom settings with project-over-global precedence.
 */
function loadCustomSettings(cwd: string): CustomSettings {
  try {
    const settingsManager = SettingsManager.create(cwd);

    const projectSettings = normalizeCustomSettings(settingsManager.getProjectSettings() as RawCustomSettings);
    const globalSettings = normalizeCustomSettings(settingsManager.getGlobalSettings() as RawCustomSettings);

    return {
      promptsDir: projectSettings.promptsDir ?? globalSettings.promptsDir,
      exaMcpEndpoint: projectSettings.exaMcpEndpoint ?? globalSettings.exaMcpEndpoint,
    };
  } catch {
    return {};
  }
}

/**
 * Get the prompts directory (with tilde expansion)
 */
export function getPromptsDir(cwd: string): string {
  const settings = loadCustomSettings(cwd);
  const dir = settings.promptsDir ?? DEFAULTS.promptsDir;
  return expandTilde(dir);
}

/**
 * Get the Exa MCP endpoint URL
 */
export function getExaMcpEndpoint(cwd: string): string {
  const settings = loadCustomSettings(cwd);
  return settings.exaMcpEndpoint ?? DEFAULTS.exaMcpEndpoint;
}
