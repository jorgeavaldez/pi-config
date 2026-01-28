/**
 * Edit Prompt Extension
 *
 * Opens editor to edit prompt files in Obsidian vault.
 * Prompts are stored in markdown with HTML comment delimiters.
 *
 * Usage:
 *   /edit              - First call prompts for filename, subsequent calls reuse it
 *
 * Features:
 *   - Two modes: "New File" (default) and "Search" (toggle with Ctrl+R)
 *   - Fuzzy file search using fd when available
 *   - Search mode requires files to exist in promptsDir
 *
 * Files stored in: configurable via promptsDir in settings.json (default: ~/.pi/prompts)
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  Input,
  matchesKey,
  Key,
  truncateToWidth,
  type Focusable,
  type TUI,
} from "@mariozechner/pi-tui";
import {
  getActiveEditFile,
  setActiveEditFile,
  clearActiveEditFile,
  openInEditor,
  generateTimestamp,
} from "./shared/editor-state.js";
import { getPromptsDir, expandTilde } from "./shared/settings-utils.js";

const STATUS_KEY = "edit-prompt";

// Module-level fd path detection
let fdPath: string | null = null;

/**
 * Detect fd binary path.
 */
function detectFd(): string | null {
  try {
    const result = spawnSync("which", ["fd"], { encoding: "utf-8", timeout: 1000 });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Convert query into a fuzzy regex pattern for fd.
 * Example: "remplage" => "r.*e.*m.*p.*l.*a.*g.*e"
 */
function buildFuzzyRegex(query: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.split("").join(".*");
}

interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  modifiedAt?: Date;
  createdAt?: Date;
  size?: number;
}

/**
 * Format a date as relative time (e.g., "2h ago", "3d ago", "2mo ago")
 */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * Search prompt files using fd with fuzzy matching.
 */
function searchPromptFiles(query: string, promptsDir: string): AutocompleteItem[] {
  if (!fdPath || !query.trim()) return [];

  try {
    const fuzzyPattern = buildFuzzyRegex(query);
    const result = spawnSync(
      fdPath,
      [
        "--base-directory",
        promptsDir,
        "--max-results",
        "50",
        "--type",
        "f",
        "--extension",
        "md",
        "--full-path",
        "--regex",
        "-i",
        fuzzyPattern,
      ],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (result.status !== 0 || !result.stdout) return [];

    const lines = result.stdout.trim().split("\n").filter(Boolean);

    return lines.slice(0, 20).map((line) => {
      const filename = basename(line);
      const fullPath = join(promptsDir, line);
      
      // Get file stats
      let modifiedAt: Date | undefined;
      let createdAt: Date | undefined;
      let size: number | undefined;
      
      try {
        const stats = statSync(fullPath);
        modifiedAt = stats.mtime;
        createdAt = stats.birthtime;
        size = stats.size;
      } catch {
        // Ignore stat errors
      }
      
      return {
        value: line,
        label: filename,
        description: line !== filename ? line : undefined,
        modifiedAt,
        createdAt,
        size,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Resolve a prompt file path based on mode.
 * Returns { path } on success, { error } on failure.
 */
function resolvePromptFile(
  input: string,
  promptsDir: string,
  mode: "new" | "search"
): { path: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No filename provided" };
  }

  const isFullPath = trimmed.startsWith("/") || trimmed.startsWith("~");
  const expanded = isFullPath ? expandTilde(trimmed) : null;

  // Normalize: add .md if missing
  const normalized = trimmed.endsWith(".md") ? trimmed : trimmed + ".md";
  const fullPath = isFullPath ? (expanded!.endsWith(".md") ? expanded! : expanded + ".md") : join(promptsDir, normalized);

  if (mode === "search") {
    // Search mode: file must exist
    if (!existsSync(fullPath)) {
      return { error: `File not found: ${isFullPath ? fullPath : normalized}` };
    }
  }

  return { path: fullPath };
}

/**
 * Custom dialog component for file selection with two modes.
 */
// Theme type extracted from the ctx.ui.custom callback
type Theme = Parameters<Parameters<ExtensionCommandContext["ui"]["custom"]>[0]>[1];

class FileSelectDialog extends Container implements Focusable {
  private mode: "new" | "search" = "new";
  private input: Input;
  private suggestions: AutocompleteItem[] = [];
  private selectedIndex = 0;
  private promptsDir: string;
  private theme: Theme;
  private tui: TUI;
  private onDone: (result: { path: string; mode: "new" | "search" } | null) => void;

  // Focusable interface
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    promptsDir: string,
    onDone: (result: { path: string; mode: "new" | "search" } | null) => void
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.promptsDir = promptsDir;
    this.onDone = onDone;

    this.input = new Input();
    this.input.onSubmit = () => this.handleSubmit();
    this.input.onEscape = () => this.handleEscape();
  }

  private handleSubmit(): void {
    // If in search mode with suggestions and one is selected, use that
    if (this.mode === "search" && this.suggestions.length > 0) {
      const selected = this.suggestions[this.selectedIndex];
      if (selected) {
        const fullPath = join(this.promptsDir, selected.value);
        this.onDone({ path: fullPath, mode: this.mode });
        return;
      }
    }

    // Otherwise resolve the input text
    const result = resolvePromptFile(this.input.getValue(), this.promptsDir, this.mode);
    if ("error" in result) {
      // Can't show error in this component, just don't submit
      // The user will see the input is still there
      return;
    }

    this.onDone({ path: result.path, mode: this.mode });
  }

  private handleEscape(): void {
    if (this.mode === "search") {
      // Go back to new file mode, preserve input text
      this.mode = "new";
      this.suggestions = [];
      this.selectedIndex = 0;
      this.invalidate();
      this.tui.requestRender();
    } else {
      // Cancel the dialog
      this.onDone(null);
    }
  }

  private applySelectedSuggestion(): void {
    if (this.mode === "search" && this.suggestions.length > 0) {
      const selected = this.suggestions[this.selectedIndex];
      if (selected) {
        // Set the input to the selected filename
        const filename = selected.label;
        this.input.setValue(filename);
        // Move cursor to end of input
        this.moveCursorToEnd();
        this.invalidate();
        this.tui.requestRender();
      }
    }
  }

  private moveCursorToEnd(): void {
    // Send End key to move cursor to end of input
    this.input.handleInput("\x1b[F"); // End key escape sequence
  }

  private toggleMode(): void {
    this.mode = this.mode === "new" ? "search" : "new";
    this.suggestions = [];
    this.selectedIndex = 0;
    
    // Refresh suggestions if switching to search mode with existing input
    if (this.mode === "search") {
      this.updateSuggestions();
    }
    
    this.invalidate();
    this.tui.requestRender();
  }

  private updateSuggestions(): void {
    if (this.mode === "search") {
      const query = this.input.getValue();
      this.suggestions = searchPromptFiles(query, this.promptsDir);
      this.selectedIndex = 0;
    } else {
      this.suggestions = [];
    }
  }

  handleInput(data: string): void {
    // Check for Ctrl+R to toggle mode (keeps input text)
    if (matchesKey(data, Key.ctrl("r"))) {
      this.toggleMode();
      return;
    }

    // Ctrl+C behavior
    if (matchesKey(data, Key.ctrl("c"))) {
      const currentValue = this.input.getValue();
      
      if (this.mode === "search") {
        if (currentValue.trim() === "") {
          // Empty search box: go back to new file mode
          this.mode = "new";
          this.suggestions = [];
          this.selectedIndex = 0;
          this.invalidate();
          this.tui.requestRender();
        } else {
          // Non-empty search box: clear the input
          this.input.setValue("");
          this.suggestions = [];
          this.selectedIndex = 0;
          this.invalidate();
          this.tui.requestRender();
        }
        return;
      }
      
      // In new mode: clear input first, then cancel if already empty
      if (currentValue.trim() === "") {
        this.onDone(null);
      } else {
        this.input.setValue("");
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    // Tab to autocomplete selected suggestion
    if (matchesKey(data, Key.tab)) {
      this.applySelectedSuggestion();
      return;
    }

    // Arrow keys for suggestion navigation in search mode
    if (this.mode === "search" && this.suggestions.length > 0) {
      if (matchesKey(data, Key.up)) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.selectedIndex = Math.min(this.suggestions.length - 1, this.selectedIndex + 1);
        this.invalidate();
        this.tui.requestRender();
        return;
      }
    }

    // Pass other input to the input component
    const prevValue = this.input.getValue();
    this.input.handleInput(data);
    
    // Update suggestions if value changed
    if (this.input.getValue() !== prevValue) {
      this.updateSuggestions();
      this.invalidate();
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const theme = this.theme;

    // Top border
    const border = new DynamicBorder((s: string) => theme.fg("border", s));
    lines.push(...border.render(width));

    // Title with mode indicator
    const modeText = this.mode === "new"
      ? "New prompt filename"
      : "Search prompts";
    const toggleHint = this.mode === "new"
      ? "Ctrl+R to search"
      : "Ctrl+R for new";
    const title = `${theme.fg("accent", theme.bold(modeText))} ${theme.fg("dim", `(${toggleHint})`)}`;
    lines.push(" " + title);

    // Input field - render using Input component's render method
    // Input already includes "> " prefix, just add leading space for alignment
    const inputLines = this.input.render(width - 1);
    for (const inputLine of inputLines) {
      lines.push(truncateToWidth(" " + inputLine, width));
    }

    // Suggestions (only in search mode with suggestions)
    if (this.mode === "search" && this.suggestions.length > 0) {
      lines.push(""); // Spacer
      
      const maxVisible = 10;
      const start = Math.max(0, this.selectedIndex - Math.floor(maxVisible / 2));
      const visibleSuggestions = this.suggestions.slice(start, start + maxVisible);
      
      for (let i = 0; i < visibleSuggestions.length; i++) {
        const suggestion = visibleSuggestions[i]!;
        const actualIndex = start + i;
        const isSelected = actualIndex === this.selectedIndex;
        
        const prefix = isSelected ? "▸ " : "  ";
        const label = suggestion.label;
        
        // Build metadata string
        const metaParts: string[] = [];
        if (suggestion.modifiedAt) {
          metaParts.push(`mod ${formatRelativeTime(suggestion.modifiedAt)}`);
        }
        if (suggestion.createdAt) {
          metaParts.push(`created ${formatRelativeTime(suggestion.createdAt)}`);
        }
        if (suggestion.size !== undefined) {
          metaParts.push(formatSize(suggestion.size));
        }
        const meta = metaParts.length > 0 ? ` ${theme.fg("dim", metaParts.join(" • "))}` : "";
        
        let line = ` ${prefix}${isSelected ? theme.fg("accent", label) : label}${meta}`;
        lines.push(truncateToWidth(line, width));
      }
      
      // Scroll indicator if needed
      if (this.suggestions.length > maxVisible) {
        const info = theme.fg("dim", ` (${this.selectedIndex + 1}/${this.suggestions.length})`);
        lines.push(info);
      }
    } else if (this.mode === "search" && this.input.getValue().trim() === "") {
      lines.push(""); // Spacer
      lines.push(` ${theme.fg("dim", "Type to search...")}`);
    }

    // Help text
    lines.push(""); // Spacer
    let helpText: string;
    if (this.mode === "search") {
      if (this.suggestions.length > 0) {
        helpText = "↑↓ navigate • tab complete • enter select • esc back • ^C clear";
      } else {
        helpText = "enter confirm • esc back • ^C clear";
      }
    } else {
      helpText = "enter confirm • esc cancel • ^C clear";
    }
    lines.push(` ${theme.fg("dim", helpText)}`);

    // Bottom border
    lines.push(...border.render(width));

    return lines;
  }

  override invalidate(): void {
    super.invalidate();
  }
}

/**
 * Prompt user for filename with two modes: new file and search.
 * Returns the full filepath or undefined if cancelled.
 */
async function promptForFile(ctx: ExtensionCommandContext, promptsDir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    ctx.ui.custom<{ path: string; mode: "new" | "search" } | null>((tui, theme, _kb, done) => {
      const dialog = new FileSelectDialog(tui, theme, promptsDir, (result) => {
        done(result);
      });

      return {
        render: (w: number) => dialog.render(w),
        invalidate: () => dialog.invalidate(),
        handleInput: (data: string) => dialog.handleInput(data),
        // Focusable support
        get focused() { return dialog.focused; },
        set focused(v: boolean) { dialog.focused = v; },
      };
    }).then((result) => {
      if (result === null) {
        resolve(undefined);
        return;
      }

      // Validate in search mode
      if (result.mode === "search") {
        if (!existsSync(result.path)) {
          ctx.ui.notify(`File not found: ${result.path}`, "error");
          resolve(undefined);
          return;
        }
      }

      resolve(result.path);
    });
  });
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
  // Detect fd on extension load
  fdPath = detectFd();

  /**
   * Update the status indicator with the current filename.
   */
  const updateStatusIndicator = (ctx: ExtensionContext) => {
    const filepath = getActiveEditFile();
    if (filepath) {
      const filename = basename(filepath);
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `📝 ${filename}`));
    } else {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

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

    updateStatusIndicator(ctx);
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
        filepath = await promptForFile(ctx, PROMPTS_DIR);
        if (!filepath) {
          return;
        }
        setActiveEditFile(filepath);
        pi.appendEntry("edit-prompt-state", { activePromptFile: filepath });
        updateStatusIndicator(ctx);
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
