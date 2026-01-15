/**
 * Custom Settings Utilities
 *
 * Reads custom extension settings from ~/.pi/agent/settings.json
 * with tilde expansion and sensible defaults.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

interface CustomSettings {
  promptsDir?: string;
  exaMcpEndpoint?: string;
}

// Sensible defaults
const DEFAULTS: Required<CustomSettings> = {
  promptsDir: "~/.pi/prompts",
  exaMcpEndpoint: "https://mcp.exa.ai/mcp",
};

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
 * Load custom settings from settings.json
 */
function loadCustomSettings(): CustomSettings {
  if (!existsSync(SETTINGS_PATH)) {
    return {};
  }
  try {
    const content = readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(content) as CustomSettings;
  } catch {
    return {};
  }
}

/**
 * Get the prompts directory (with tilde expansion)
 */
export function getPromptsDir(): string {
  const settings = loadCustomSettings();
  const dir = settings.promptsDir ?? DEFAULTS.promptsDir;
  return expandTilde(dir);
}

/**
 * Get the Exa MCP endpoint URL
 */
export function getExaMcpEndpoint(): string {
  const settings = loadCustomSettings();
  return settings.exaMcpEndpoint ?? DEFAULTS.exaMcpEndpoint;
}
