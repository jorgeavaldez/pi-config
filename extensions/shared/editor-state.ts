/**
 * Shared Editor State and Utilities
 *
 * Provides shared state and utilities for extensions that work with
 * external editors and prompt files.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// =============================================================================
// Module State
// =============================================================================

let activeEditFile: string | undefined;

/**
 * Get the currently active edit file path (set by /edit command).
 */
export function getActiveEditFile(): string | undefined {
  return activeEditFile;
}

/**
 * Set the active edit file path.
 */
export function setActiveEditFile(filepath: string): void {
  activeEditFile = filepath;
}

/**
 * Clear the active edit file (used on session changes).
 */
export function clearActiveEditFile(): void {
  activeEditFile = undefined;
}

// =============================================================================
// Editor Utilities
// =============================================================================

/**
 * Get the user's preferred editor with fallback chain.
 * $EDITOR → $VISUAL → first available of nvim/vim/vi → vi
 */
function getEditor(): string {
  const configuredEditor = process.env.EDITOR || process.env.VISUAL;
  if (configuredEditor) {
    return configuredEditor;
  }

  for (const candidate of ["nvim", "vim", "vi"] as const) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 1000 });
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return "vi";
}

/** Launch the configured editor without a shell; callers own terminal suspension. */
export function runEditor(filepath: string, cursorLine?: number): Promise<number | null> {
  const editor = getEditor();
  // EDITOR is a command plus arguments, not a single executable path. Preserve
  // quoted paths and Windows backslashes without invoking a shell.
  const parts = (editor.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((part) =>
    part.replace(/"([^"]*)"|'([^']*)'/g, (_match, double: string | undefined, single: string | undefined) =>
      double ?? single ?? ""
    )
  );
  const command = parts.shift();
  if (!command) return Promise.resolve(null);
  const editorName = editor.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (cursorLine !== undefined && /vi|nano|emacs/.test(editorName)) {
    parts.push(`+${cursorLine}`);
  }
  parts.push(filepath);

  // Async spawning releases Pi's console input before Neovim reads it on Windows.
  return new Promise((resolve) => {
    const child = spawn(command, parts, { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(null));
    child.on("close", resolve);
  });
}

/** Open an editor with the TUI suspended. Only exit status 0 means committed. */
export async function openInEditor(
  filepath: string,
  cursorLine: number | undefined,
  ctx: ExtensionContext
): Promise<boolean> {
  if (ctx.mode !== "tui") return false;

  return ctx.ui.custom<boolean>(async (tui: TUI, _theme, _kb, done) => {
    // Stop TUI to release terminal
    tui.stop();

    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H");

    let succeeded = false;
    try {
      succeeded = (await runEditor(filepath, cursorLine)) === 0;
    } finally {
      tui.start();
      tui.requestRender(true);
    }

    done(succeeded);

    // Return empty component (immediately disposed since done() was called)
    const emptyComponent: Component = {
      render: () => [],
      invalidate: () => {},
    };
    return emptyComponent;
  });
}

// =============================================================================
// Timestamp Utilities
// =============================================================================

/**
 * Generate ISO timestamp for section markers.
 * Format: YYYY-MM-DDTHH:MM:SS (no milliseconds, no timezone)
 */
export function generateTimestamp(): string {
  return new Date().toISOString().slice(0, 19);
}

// =============================================================================
// Frontmatter & Section Utilities
// =============================================================================

/**
 * Find the line index (0-based) of the frontmatter closing delimiter (second '---').
 * Returns -1 if no frontmatter is found.
 */
export function findFrontmatterEndLine(lines: string[]): number {
  let dashCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      dashCount++;
      if (dashCount === 2) return i;
    }
  }
  return -1;
}

/**
 * Insert a section string into an existing file, after frontmatter if present.
 * Returns the 1-indexed line number where the section starts.
 * Caller must ensure the file exists.
 */
export function insertSectionAfterFrontmatter(filepath: string, section: string): number {
  const content = readFileSync(filepath, "utf-8");
  const lines = content.split("\n");
  const sectionLines = section.split("\n");
  const frontmatterEndLine = findFrontmatterEndLine(lines);

  if (frontmatterEndLine === -1) {
    const newContent = `${section}\n\n${content}`;
    writeFileSync(filepath, newContent, "utf-8");
    return 1;
  }

  const before = lines.slice(0, frontmatterEndLine + 1);
  const after = lines.slice(frontmatterEndLine + 1);
  const newLines = [...before, "", ...sectionLines, "", ...after];
  writeFileSync(filepath, newLines.join("\n"), "utf-8");

  // frontmatterEndLine is 0-indexed; +1 for 1-indexing, +1 for blank line, +1 for first section line
  return frontmatterEndLine + 3;
}

/**
 * Extract trimmed text between two marker strings in content.
 * Returns null if either marker is missing, end comes before start, or result is empty.
 */
export function extractBetweenMarkers(content: string, startMarker: string, endMarker: string): string | null {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) return null;

  const endIndex = content.indexOf(endMarker);
  if (endIndex === -1) return null;

  const contentStart = startIndex + startMarker.length;
  if (endIndex <= contentStart) return null;

  const text = content.slice(contentStart, endIndex).trim();
  return text || null;
}

// =============================================================================
// Editor-open Section Utilities
// =============================================================================

/**
 * Build reference/prompt section markers for a given timestamp.
 */
export function getEditorOpenMarkers(timestamp: string) {
  return {
    referenceStart: `<!-- REFERENCE: ${timestamp} -->`,
    promptStart: `<!-- PROMPT: ${timestamp} -->`,
    sectionEnd: `<!-- /REFERENCE: ${timestamp} -->`,
  };
}

/**
 * Create a reference + prompt section string.
 * When reference is null, only the prompt markers are emitted (no reference block).
 */
export function createEditorOpenSection(reference: string | null, timestamp: string, prompt = ""): string {
  const { referenceStart, promptStart, sectionEnd } = getEditorOpenMarkers(timestamp);

  if (reference === null) {
    return `${promptStart}
${prompt}
${sectionEnd}`;
  }

  return `${referenceStart}
${reference}
${promptStart}
${prompt}
${sectionEnd}`;
}

/**
 * Extract the prompt from a reference/prompt section identified by timestamp.
 * Returns the text between <!-- PROMPT: TIMESTAMP --> and <!-- /REFERENCE: TIMESTAMP -->.
 * Returns null if markers are missing/malformed or if prompt is empty after trim.
 */
export function extractEditorOpenPrompt(content: string, timestamp: string): string | null {
  const { promptStart, sectionEnd } = getEditorOpenMarkers(timestamp);
  return extractBetweenMarkers(content, promptStart, sectionEnd);
}

/**
 * Verify that the reference section in the file matches what we expect.
 * When expectedReference is null (no reference block), just verify prompt markers exist.
 * Otherwise, returns true if reference markers exist and reference text is unchanged.
 */
export function verifyEditorOpenReference(
  content: string,
  timestamp: string,
  expectedReference: string | null
): boolean {
  const { referenceStart, promptStart } = getEditorOpenMarkers(timestamp);

  // No reference block expected — just check prompt markers exist
  if (expectedReference === null) {
    return content.includes(promptStart);
  }

  const referenceIndex = content.indexOf(referenceStart);
  if (referenceIndex === -1) {
    return false;
  }

  const promptIndex = content.indexOf(promptStart);
  if (promptIndex === -1) {
    return false;
  }

  const contentStart = referenceIndex + referenceStart.length;

  // Validate order
  if (promptIndex <= contentStart) {
    return false;
  }

  const actualReference = content.slice(contentStart, promptIndex).trim();
  return actualReference === expectedReference.trim();
}
