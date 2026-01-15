/**
 * Edit Prompt Extension
 *
 * Opens editor to edit prompt files in Obsidian vault.
 * Prompts are stored in markdown with HTML comment delimiters.
 *
 * Usage:
 *   /edit              - First call prompts for filename, subsequent calls reuse it
 *
 * Files stored in: configurable via promptsDir in settings.json (default: ~/.pi/prompts)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { join, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  getActiveEditFile,
  setActiveEditFile,
  clearActiveEditFile,
  openInEditor,
  generateTimestamp,
} from "./shared/editor-state.js";
import { getPromptsDir } from "./shared/settings-utils.js";

/**
 * Generate frontmatter for a new file.
 */
function generateFrontmatter(filepath: string): string {
  const filename = basename(filepath);
  const id = filename.endsWith(".md") ? filename.slice(0, -3) : filename;

  return `---
id: ${id}
aliases: []
tags: []
---`;
}

/**
 * Prompt user for filename, handling .md extension and existing file confirmation.
 * Returns the normalized filename (with .md) or undefined if cancelled.
 */
async function getFilename(ctx: ExtensionCommandContext, promptsDir: string): Promise<string | undefined> {
  while (true) {
    const input = await ctx.ui.input("Prompt filename:");

    if (input === undefined || input.trim() === "") {
      return undefined;
    }

    let filename = input.trim();

    if (!filename.endsWith(".md")) {
      filename = filename + ".md";
    }

    const filepath = join(promptsDir, filename);
    if (existsSync(filepath)) {
      const continueWithExisting = await ctx.ui.confirm(
        "File exists",
        `${filename} already exists. Continue with this file?`
      );

      if (continueWithExisting) {
        return filename;
      }
      continue;
    }

    return filename;
  }
}

/**
 * Prepare the file for editing. Creates new file or prepends section to existing.
 * Returns the line number where cursor should be positioned and the timestamp used.
 */
function prepareFile(filepath: string): { cursorLine: number; timestamp: string } {
  const timestamp = generateTimestamp();
  const startMarker = `<!-- prompt: ${timestamp} -->`;
  const endMarker = `<!-- prompt-end: ${timestamp} -->`;

  if (!existsSync(filepath)) {
    const content = `${generateFrontmatter(filepath)}

${startMarker}

${endMarker}

`;
    writeFileSync(filepath, content, "utf-8");
    // Line numbers (1-indexed):
    // 1: ---
    // 2: id: ...
    // 3: aliases: []
    // 4: tags: []
    // 5: ---
    // 6: (blank)
    // 7: <!-- prompt: ... -->
    // 8: (blank) <-- cursor here
    // 9: <!-- prompt-end: ... -->
    // 10: (blank)
    return { cursorLine: 8, timestamp };
  }

  const content = readFileSync(filepath, "utf-8");
  const lines = content.split("\n");

  // Find end of frontmatter (second '---')
  let frontmatterEndLine = -1;
  let dashCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim() === "---") {
      dashCount++;
      if (dashCount === 2) {
        frontmatterEndLine = i;
        break;
      }
    }
  }

  if (frontmatterEndLine === -1) {
    // No frontmatter found - prepend at start (shouldn't happen with our files)
    const newContent = `${startMarker}\n\n${endMarker}\n\n${content}`;
    writeFileSync(filepath, newContent, "utf-8");
    return { cursorLine: 2, timestamp };
  }

  // Insert new section after frontmatter
  const beforeFrontmatter = lines.slice(0, frontmatterEndLine + 1);
  const afterFrontmatter = lines.slice(frontmatterEndLine + 1);

  // Build new content: frontmatter, blank, start marker, blank (cursor), end marker, blank, old content
  const newLines = [...beforeFrontmatter, "", startMarker, "", endMarker, "", ...afterFrontmatter];

  writeFileSync(filepath, newLines.join("\n"), "utf-8");

  // Cursor position calculation:
  // frontmatterEndLine is 0-indexed, nvim lines are 1-indexed
  // frontmatter ends at line (frontmatterEndLine + 1) in 1-indexed
  // blank line: frontmatterEndLine + 2
  // start marker: frontmatterEndLine + 3
  // cursor (blank line after start marker): frontmatterEndLine + 4
  // end marker: frontmatterEndLine + 5
  // blank line: frontmatterEndLine + 6
  return { cursorLine: frontmatterEndLine + 4, timestamp };
}

/**
 * Extract the content of a specific prompt section identified by timestamp.
 * Returns the text between <!-- prompt: TIMESTAMP --> and <!-- prompt-end: TIMESTAMP -->.
 * Returns empty string if either marker is missing or end comes before start.
 */
function extractSection(filepath: string, timestamp: string): string {
  if (!existsSync(filepath)) {
    return "";
  }

  const content = readFileSync(filepath, "utf-8");

  // Build exact marker strings for this timestamp
  const startMarker = `<!-- prompt: ${timestamp} -->`;
  const endMarker = `<!-- prompt-end: ${timestamp} -->`;

  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    return "";
  }

  const endIndex = content.indexOf(endMarker);
  if (endIndex === -1) {
    return "";
  }

  const contentStart = startIndex + startMarker.length;

  // Validate: end must come after start
  if (endIndex <= contentStart) {
    return "";
  }

  return content.slice(contentStart, endIndex).trim();
}



export default function editPromptExtension(pi: ExtensionAPI) {
  /**
   * Reconstruct state from session entries.
   * Finds the last edit-prompt-state entry and restores activeEditFile in shared state.
   */
  const reconstructState = (ctx: ExtensionContext) => {
    clearActiveEditFile();

    const entries = ctx.sessionManager.getEntries();
    const stateEntry = entries
      .filter((e: { type: string; customType?: string }) =>
        e.type === "custom" && e.customType === "edit-prompt-state"
      )
      .pop() as { data?: { activePromptFile: string } } | undefined;

    if (stateEntry?.data?.activePromptFile) {
      setActiveEditFile(stateEntry.data.activePromptFile);
    }
  };

  // Reconstruct state on session lifecycle events
  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

  pi.registerCommand("edit", {
    description: "Edit a prompt file in your editor and execute it",
    handler: async (_args, ctx) => {
      const PROMPTS_DIR = getPromptsDir();

      // 1. Check UI availability
      if (!ctx.hasUI) {
        ctx.ui.notify("/edit requires interactive mode", "error");
        return;
      }

      // 2. Validate prompts directory exists
      if (!existsSync(PROMPTS_DIR)) {
        ctx.ui.notify(`Directory does not exist: ${PROMPTS_DIR}`, "error");
        return;
      }

      // 3. Get filename (prompt on first call, reuse on subsequent)
      let filepath = getActiveEditFile();

      if (!filepath) {
        const filename = await getFilename(ctx, PROMPTS_DIR);
        if (!filename) {
          return;
        }
        filepath = join(PROMPTS_DIR, filename);
        setActiveEditFile(filepath);
        pi.appendEntry("edit-prompt-state", { activePromptFile: filepath });
      }

      // 4. Prepare file (create new or prepend section to existing)
      const { cursorLine, timestamp } = prepareFile(filepath);

      // 5. Open editor
      const exitCode = await openInEditor(filepath, cursorLine, ctx);

      if (exitCode === null) {
        ctx.ui.notify("Editor closed unexpectedly", "warning");
        return;
      }

      // 6. Extract and execute prompt (only from the section we created)
      const prompt = extractSection(filepath, timestamp);

      if (!prompt || prompt.trim() === "") {
        ctx.ui.notify("No prompt entered", "info");
        return;
      }

      // Execute the prompt
      pi.sendUserMessage(prompt.trim());
    },
  });
}
