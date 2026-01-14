/**
 * Shared Editor State and Utilities
 *
 * Provides shared state and utilities for extensions that work with
 * external editors and the Obsidian vault prompt files.
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
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
  ctx: ExtensionCommandContext
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
// Q&A Section Utilities
// =============================================================================

/**
 * Build the Q&A section markers for a given timestamp.
 */
export function getQnaMarkers(timestamp: string) {
  return {
    questionsStart: `<!-- QUESTIONS: ${timestamp} -->`,
    answersStart: `<!-- ANSWERS: ${timestamp} -->`,
    sectionEnd: `<!-- /QUESTIONS: ${timestamp} -->`,
  };
}

/**
 * Create a Q&A section string with the given questions.
 */
export function createQnaSection(questions: string, timestamp: string): string {
  const { questionsStart, answersStart, sectionEnd } = getQnaMarkers(timestamp);

  return `${questionsStart}
${questions}
${answersStart}

${sectionEnd}`;
}

/**
 * Extract the answers from a Q&A section identified by timestamp.
 * Returns the text between <!-- ANSWERS: TIMESTAMP --> and <!-- /QUESTIONS: TIMESTAMP -->.
 * Returns null if markers are missing or malformed.
 */
export function extractQnaAnswers(content: string, timestamp: string): string | null {
  const { answersStart, sectionEnd } = getQnaMarkers(timestamp);

  const answersIndex = content.indexOf(answersStart);
  if (answersIndex === -1) {
    return null;
  }

  const endIndex = content.indexOf(sectionEnd);
  if (endIndex === -1) {
    return null;
  }

  const contentStart = answersIndex + answersStart.length;

  // Validate: end must come after answers start
  if (endIndex <= contentStart) {
    return null;
  }

  const answers = content.slice(contentStart, endIndex).trim();
  return answers || null;
}

/**
 * Verify that the questions in the file match what we expect.
 * Returns true if the questions section exists and contains the expected questions.
 */
export function verifyQnaQuestions(content: string, timestamp: string, expectedQuestions: string): boolean {
  const { questionsStart, answersStart } = getQnaMarkers(timestamp);

  const questionsIndex = content.indexOf(questionsStart);
  if (questionsIndex === -1) {
    return false;
  }

  const answersIndex = content.indexOf(answersStart);
  if (answersIndex === -1) {
    return false;
  }

  const contentStart = questionsIndex + questionsStart.length;

  // Validate order
  if (answersIndex <= contentStart) {
    return false;
  }

  const actualQuestions = content.slice(contentStart, answersIndex).trim();
  return actualQuestions === expectedQuestions.trim();
}
