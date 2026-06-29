/**
 * Shared Editor State and Utilities
 *
 * Provides shared state and utilities for extensions that work with
 * external editors and prompt files.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
export function getEditor(): string {
  const configuredEditor = process.env.EDITOR || process.env.VISUAL;
  if (configuredEditor) {
    return configuredEditor;
  }

  for (const candidate of ["nvim", "vim", "vi"] as const) {
    try {
      const result = spawnSync("which", [candidate], { encoding: "utf-8", timeout: 1000 });
      if (result.status === 0 && result.stdout.trim()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return "vi";
}

/**
 * Get editor arguments to position cursor at a specific line.
 * Supports vim/nvim/vi, nano, and emacs.
 */
export function getEditorArgs(filePath: string, cursorLine?: number): string[] {
  if (cursorLine === undefined) {
    return [filePath];
  }

  const editor = getEditor();
  const editorName = editor.split("/").pop()?.toLowerCase() || "";

  // vim, nvim, vi all support +line syntax
  if (editorName.includes("vim") || editorName.includes("vi") || editorName === "nvim") {
    return [`+${cursorLine}`, filePath];
  }

  // nano supports +line syntax
  if (editorName.includes("nano")) {
    return [`+${cursorLine}`, filePath];
  }

  // emacs supports +line syntax
  if (editorName.includes("emacs")) {
    return [`+${cursorLine}`, filePath];
  }

  // Default: just the file path
  return [filePath];
}

/**
 * Open a file in the user's editor, suspending TUI during editing.
 * Returns the editor's exit code, or null if something went wrong.
 */
export async function openInEditor(
  filepath: string,
  cursorLine: number | undefined,
  ctx: ExtensionContext
): Promise<number | null> {
  if (ctx.mode !== "tui") {
    return null;
  }

  const editor = getEditor();
  const editorArgs = getEditorArgs(filepath, cursorLine);

  return ctx.ui.custom<number | null>((tui: TUI, _theme, _kb, done) => {
    // Stop TUI to release terminal
    tui.stop();

    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H");

    // Spawn editor
    const result = spawnSync(editor, editorArgs, {
      stdio: "inherit",
      env: process.env,
    });

    // Restart TUI
    tui.start();
    tui.requestRender(true);

    // Signal completion
    done(result.status);

    // Return empty component (immediately disposed since done() was called)
    const emptyComponent: Component = {
      render: () => [],
      invalidate: () => {},
    };
    return emptyComponent;
  });
}

export interface ExternalTextEditOptions {
  tempFilePrefix?: string;
  cursorLine?: number;
}

/**
 * Edit prefilled text through the configured external editor.
 *
 * Return values:
 * - string: user committed edits
 * - undefined: user cancelled/aborted
 * - null: runtime/protocol error
 */
export async function editTextExternally(
  initialText: string,
  ctx: ExtensionContext,
  options: ExternalTextEditOptions = {}
): Promise<string | undefined | null> {
  const tempDir = mkdtempSync(join(tmpdir(), options.tempFilePrefix ?? "pi-external-edit-"));
  const tempFile = join(tempDir, "buffer.md");

  try {
    writeFileSync(tempFile, initialText, "utf-8");

    const cursorLine = options.cursorLine ?? 1;
    const exitCode = await openInEditor(tempFile, cursorLine, ctx);

    if (exitCode === null) {
      return null;
    }

    if (exitCode === 1) {
      return undefined;
    }

    if (exitCode !== 0) {
      return null;
    }

    return readFileSync(tempFile, "utf-8");
  } catch {
    return null;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
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
