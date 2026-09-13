/**
 * Draft a prompt beside the previous user-facing message in one temporary buffer.
 * Only the prompt section is submitted; the reference must remain unchanged.
 */

import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEditorOpenSection,
  extractEditorOpenPrompt,
  openInEditor,
  verifyEditorOpenReference,
} from "./shared/editor-state.js";

/** Read only visible message text, never system instructions or tool output. */
function getLastMessageContent(ctx: ExtensionContext): string | null {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    const message =
      entry?.type === "custom_message" && entry.display
        ? entry
        : entry?.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")
          ? entry.message
          : undefined;
    if (!message) continue;

    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    if (text.trim()) return text.trim();
  }

  return null;
}

export default function editorOpenExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const openPrompt = async () => {
      const timestamp = new Date().toISOString().slice(0, 19);
      const reference = getLastMessageContent(ctx);
      const prefillPrompt = ctx.ui.getEditorText();
      const tempDir = mkdtempSync(join(tmpdir(), "pi-editor-open-"));
      const filepath = join(tempDir, "prompt.md");
      const cursorLine = reference === null ? 2 : reference.split("\n").length + 3;

      try {
        writeFileSync(filepath, createEditorOpenSection(reference, timestamp, prefillPrompt) + "\n", "utf-8");
        if (!(await openInEditor(filepath, cursorLine, ctx))) {
          ctx.ui.notify("Editor cancelled or failed; nothing submitted", "warning");
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
        rmSync(tempDir, { recursive: true, force: true });
      }
    };

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new (class extends CustomEditor {
          override handleInput(data: string): void {
            // Search and other focused UI handle input before it reaches this editor.
            if (keybindings.matches(data, "app.editor.external")) {
              void openPrompt().catch((error: unknown) => {
                ctx.ui.notify(`Editor-open failed: ${error instanceof Error ? error.message : String(error)}`, "error");
              });
              return;
            }
            super.handleInput(data);
          }
        })(tui, theme, keybindings, { embedWorkingStatus: true }),
    );
  });
}
