/** External editor launching and reference/prompt section utilities. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { spawn, spawnSync } from "node:child_process";

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
// Editor-open Section Utilities
// =============================================================================

/**
 * Build reference/prompt section markers for a given timestamp.
 */
function getEditorOpenMarkers(timestamp: string) {
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
  const startIndex = content.indexOf(promptStart);
  if (startIndex === -1) return null;

  const endIndex = content.indexOf(sectionEnd);
  const contentStart = startIndex + promptStart.length;
  if (endIndex <= contentStart) return null;

  return content.slice(contentStart, endIndex).trim() || null;
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
