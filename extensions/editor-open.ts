/**
 * Editor-open Extension
 *
 * Custom Ctrl+G flow that opens an editor section containing:
 * - The last message as reference material
 * - A prompt section for the next user message
 *
 * If /edit has an active file, the section is prepended there.
 * Otherwise, a temporary file is created.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createEditorOpenSection,
  extractEditorOpenPrompt,
  generateTimestamp,
  insertSectionAfterFrontmatter,
  openInEditor,
  verifyEditorOpenReference,
} from "./shared/editor-state.js";

/**
 * Get the active edit file from session entries.
 * Uses session history (not module state) to avoid cross-extension module instance issues.
 */
function getActiveEditFileFromSession(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();
  const stateEntry = branch
    .filter((e: { type: string; customType?: string }) =>
      e.type === "custom" && e.customType === "edit-prompt-state"
    )
    .pop() as { data?: { activePromptFile?: string } } | undefined;

  return stateEntry?.data?.activePromptFile;
}

/**
 * Extract user-facing text from a message content payload.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const lines: string[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const part = item as { type?: string; text?: string };

    if (part.type === "text" && typeof part.text === "string") {
      lines.push(part.text);
      continue;
    }

    if (part.type === "thinking" || part.type === "toolCall") {
      continue;
    }

    if (typeof part.text === "string") {
      lines.push(part.text);
    }
  }

  return lines.join("\n").trim();
}

/**
 * Get the latest message text from the current branch, preferring non-tool messages.
 * Returns null when there are no messages (fresh session).
 */
function getLastMessageContent(ctx: ExtensionContext): string | null {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i] as { type?: string; message?: { role?: string; content?: unknown } } | undefined;
    if (!entry || entry.type !== "message" || !entry.message) {
      continue;
    }

    const role = entry.message.role;
    if (role === "toolResult" || role === "bashExecution") {
      continue;
    }

    const text = extractMessageText(entry.message.content);
    if (text) {
      return text;
    }
  }

  return null;
}

/**
 * Create a temp file for editor-open flow.
 */
function createTempFile(reference: string | null, timestamp: string, prefillPrompt: string): {
  tempFile: string;
  cursorLine: number;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-editor-open-"));
  const tempFile = join(tempDir, "prompt.md");

  const content = createEditorOpenSection(reference, timestamp, prefillPrompt) + "\n";
  writeFileSync(tempFile, content, "utf-8");

  if (reference === null) {
    // No reference block: <!-- PROMPT --> on line 1, cursor on line 2
    const cursorLine = 2;
    return { tempFile, cursorLine };
  }

  const referenceLines = reference.split("\n").length;
  const cursorLine = 1 + referenceLines + 2;

  return { tempFile, cursorLine };
}

/**
 * Prepend a reference/prompt section at the top (after frontmatter when present).
 */
function prependSectionToFile(
  filepath: string,
  reference: string | null,
  timestamp: string,
  prefillPrompt: string
): number {
  const section = createEditorOpenSection(reference, timestamp, prefillPrompt);
  // When no reference, section is just: PROMPT marker + prompt + END marker (3 lines)
  // Cursor goes to line 2 (the prompt line) relative to section start
  const cursorOffsetInSection = reference === null ? 1 : (reference.split("\n").length + 2);

  if (!existsSync(filepath)) {
    writeFileSync(filepath, section + "\n\n", "utf-8");
    return 1 + cursorOffsetInSection;
  }

  const sectionStart = insertSectionAfterFrontmatter(filepath, section);
  return sectionStart + cursorOffsetInSection;
}

function cleanupTempFile(tempFile: string): void {
  try {
    rmSync(dirname(tempFile), { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

export default function editorOpenExtension(pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+g", {
    description: "Open editor with last message reference and prompt section",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") {
        return;
      }

      const timestamp = generateTimestamp();
      const reference = getLastMessageContent(ctx);
      const prefillPrompt = ctx.ui.getEditorText();
      const activeEditFile = getActiveEditFileFromSession(ctx);

      let filepath: string;
      let cursorLine: number;
      let usingTempFile = false;

      if (activeEditFile) {
        filepath = activeEditFile;
        cursorLine = prependSectionToFile(filepath, reference, timestamp, prefillPrompt);
      } else {
        const temp = createTempFile(reference, timestamp, prefillPrompt);
        filepath = temp.tempFile;
        cursorLine = temp.cursorLine;
        usingTempFile = true;
      }

      try {
        const exitCode = await openInEditor(filepath, cursorLine, ctx);

        if (exitCode === null) {
          ctx.ui.notify("Editor closed unexpectedly", "warning");
          return;
        }

        let content: string;
        try {
          content = readFileSync(filepath, "utf-8");
        } catch {
          ctx.ui.notify("Failed to read file after editing", "error");
          return;
        }

        if (!verifyEditorOpenReference(content, timestamp, reference)) {
          ctx.ui.notify("Reference section was modified - please keep it unchanged", "error");
          return;
        }

        const prompt = extractEditorOpenPrompt(content, timestamp);
        if (!prompt) {
          ctx.ui.notify("No prompt entered", "info");
          return;
        }

        ctx.ui.setEditorText("");
        pi.sendUserMessage(prompt);
      } finally {
        if (usingTempFile) {
          cleanupTempFile(filepath);
        }
      }
    },
  });
}
