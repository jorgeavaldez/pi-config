/**
 * Edit Prompt Extension
 *
 * Opens neovim to edit prompt files in Obsidian vault.
 * Prompts are stored in markdown with HTML comment delimiters.
 *
 * Usage:
 *   /edit              - First call prompts for filename, subsequent calls reuse it
 *
 * Files stored in: ~/obsidian/delvaze/prompts/
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { TUI, Component } from "@mariozechner/pi-tui";

const PROMPTS_DIR = join(homedir(), "obsidian", "delvaze", "prompts");

/**
 * Generate ISO timestamp for section marker.
 * Format: YYYY-MM-DDTHH:MM:SS (no milliseconds, no timezone)
 */
function generateTimestamp(): string {
  return new Date().toISOString().slice(0, 19);
}

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
 * Generate a section marker with current timestamp.
 */
function generateSectionMarker(): string {
  return `<!-- prompt: ${generateTimestamp()} -->`;
}

/**
 * Prompt user for filename, handling .md extension and existing file confirmation.
 * Returns the normalized filename (with .md) or undefined if cancelled.
 */
async function getFilename(ctx: ExtensionCommandContext): Promise<string | undefined> {
  while (true) {
    const input = await ctx.ui.input("Prompt filename:");

    if (input === undefined || input.trim() === "") {
      return undefined;
    }

    let filename = input.trim();

    if (!filename.endsWith(".md")) {
      filename = filename + ".md";
    }

    const filepath = join(PROMPTS_DIR, filename);
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
 * Returns the line number where cursor should be positioned.
 */
function prepareFile(filepath: string): number {
  const sectionMarker = generateSectionMarker();

  if (!existsSync(filepath)) {
    const content = `${generateFrontmatter(filepath)}

${sectionMarker}

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
    return 8;
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
    const newContent = `${sectionMarker}\n\n${content}`;
    writeFileSync(filepath, newContent, "utf-8");
    return 2;
  }

  // Insert new section after frontmatter
  const beforeFrontmatter = lines.slice(0, frontmatterEndLine + 1);
  const afterFrontmatter = lines.slice(frontmatterEndLine + 1);

  // Build new content: frontmatter, blank line, NEW section marker, blank line, old content
  const newLines = [...beforeFrontmatter, "", sectionMarker, "", ...afterFrontmatter];

  writeFileSync(filepath, newLines.join("\n"), "utf-8");

  // Cursor position calculation:
  // frontmatterEndLine is 0-indexed, nvim lines are 1-indexed
  // frontmatter ends at line (frontmatterEndLine + 1) in 1-indexed
  // blank line: frontmatterEndLine + 2
  // section marker: frontmatterEndLine + 3
  // cursor (blank line after marker): frontmatterEndLine + 4
  return frontmatterEndLine + 4;
}

/**
 * Extract the content of the first (newest) prompt section from a file.
 * Returns the text between the first <!-- prompt: ... --> and the next one (or EOF).
 */
function extractFirstSection(filepath: string): string {
  if (!existsSync(filepath)) {
    return "";
  }

  const content = readFileSync(filepath, "utf-8");

  // Regex to match section markers
  const markerRegex = /<!-- prompt: [^>]+ -->/g;

  // Find all markers with their positions
  const markers: Array<{ index: number; length: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(content)) !== null) {
    markers.push({ index: match.index, length: match[0].length });
  }

  const firstMarker = markers[0];
  if (firstMarker === undefined) {
    return "";
  }

  // First section: from end of first marker to start of second marker (or EOF)
  const firstMarkerEnd = firstMarker.index + firstMarker.length;
  const secondMarker = markers[1];
  const sectionEnd = secondMarker !== undefined ? secondMarker.index : content.length;

  const section = content.slice(firstMarkerEnd, sectionEnd);
  return section.trim();
}

/**
 * Open file in neovim with cursor at specified line.
 * Suspends TUI during editing, resumes after.
 */
async function openInNeovim(
  filepath: string,
  cursorLine: number,
  ctx: ExtensionCommandContext
): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui: TUI, _theme, _kb, done) => {
    // Stop TUI to release terminal
    tui.stop();

    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H");

    // Run neovim with cursor at specified line
    const result = spawnSync("nvim", [`+${cursorLine}`, filepath], {
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

export default function editPromptExtension(pi: ExtensionAPI) {
  // Session state - tracks the active prompt file for this session
  let activePromptFile: string | undefined;

  pi.registerCommand("edit", {
    description: "Edit a prompt file in neovim and execute it",
    handler: async (_args, ctx) => {
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
      let filepath: string;

      if (activePromptFile) {
        filepath = activePromptFile;
      } else {
        const filename = await getFilename(ctx);
        if (!filename) {
          return;
        }
        filepath = join(PROMPTS_DIR, filename);
        activePromptFile = filepath;
      }

      // 4. Prepare file (create new or prepend section to existing)
      const cursorLine = prepareFile(filepath);

      // 5. Open neovim
      const exitCode = await openInNeovim(filepath, cursorLine, ctx);

      if (exitCode === null) {
        ctx.ui.notify("Editor closed unexpectedly", "warning");
        return;
      }

      // 6. Extract and execute prompt
      const prompt = extractFirstSection(filepath);

      if (!prompt || prompt.trim() === "") {
        ctx.ui.notify("No prompt entered", "info");
        return;
      }

      // Execute the prompt
      pi.sendUserMessage(prompt.trim());
    },
  });
}
