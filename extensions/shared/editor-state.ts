/**
 * Shared Editor State and Utilities
 *
 * Provides shared state and utilities for extensions that work with
 * external editors and prompt files.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TUI, Component } from "@mariozechner/pi-tui";
import { spawnSync } from "node:child_process";

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
 * $EDITOR → $VISUAL → nvim → vim → vi
 */
export function getEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || "nvim" || "vim" || "vi";
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
 */
export function createEditorOpenSection(reference: string, timestamp: string, prompt = ""): string {
  const { referenceStart, promptStart, sectionEnd } = getEditorOpenMarkers(timestamp);

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

  const promptIndex = content.indexOf(promptStart);
  if (promptIndex === -1) {
    return null;
  }

  const endIndex = content.indexOf(sectionEnd);
  if (endIndex === -1) {
    return null;
  }

  const contentStart = promptIndex + promptStart.length;

  // Validate: end must come after prompt start
  if (endIndex <= contentStart) {
    return null;
  }

  const prompt = content.slice(contentStart, endIndex).trim();
  return prompt || null;
}

/**
 * Verify that the reference section in the file matches what we expect.
 * Returns true if reference markers exist and reference text is unchanged.
 */
export function verifyEditorOpenReference(
  content: string,
  timestamp: string,
  expectedReference: string
): boolean {
  const { referenceStart, promptStart } = getEditorOpenMarkers(timestamp);

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
