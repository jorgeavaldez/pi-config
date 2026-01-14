/**
 * Q&A Extension - Draft questions and answer via external editor
 *
 * Provides a tool for the LLM to draft clarifying questions, and a command
 * for the user to answer them in their preferred editor ($EDITOR).
 *
 * Usage:
 *   1. Ask the agent to clarify something - it calls draft_questions
 *   2. Run /answer to open your editor with the questions
 *   3. Write your responses below the "<!-- ANSWERS -->" marker, save and quit
 *   4. Your answers are sent to the LLM as a user message
 *
 * Commands:
 *   /answer    - Open editor to answer pending questions
 *   /questions - View pending questions without opening editor
 *
 * If you send a new prompt without calling /answer, the pending questions
 * are cleared and the conversation continues normally.
 *
 * Integration with edit-prompt:
 *   If /edit has been used to set an active file, questions are appended
 *   to that file instead of creating a temporary file. This keeps your
 *   Q&A history in the Obsidian vault.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getActiveEditFile,
  openInEditor,
  generateTimestamp,
  createQnaSection,
  extractQnaAnswers,
  verifyQnaQuestions,
} from "./shared/editor-state.js";

interface DraftQuestionsDetails {
	questions: string;
	timestamp: string;
}

interface QnaClearData {
	reason: "answered" | "skipped";
}

/**
 * Create temp file with questions using HTML comment delimiters.
 * Returns the temp file path and cursor line number.
 */
function createTempFile(questions: string, timestamp: string): { tempFile: string; cursorLine: number } {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-qna-"));
	const tempFile = join(tempDir, "questions.md");

	const content = createQnaSection(questions, timestamp) + "\n";

	writeFileSync(tempFile, content, "utf-8");

	// Calculate cursor line (line after ANSWERS marker)
	// Line 1: <!-- QUESTIONS: timestamp -->
	// Lines 2-N: questions
	// Line N+1: <!-- ANSWERS: timestamp -->
	// Line N+2: (cursor here - blank line for answer)
	const questionLines = questions.split("\n").length;
	const cursorLine = 1 + questionLines + 2; // start marker + questions + answers marker + 1

	return { tempFile, cursorLine };
}

/**
 * Prepend Q&A section to the active edit file after frontmatter.
 * Returns the cursor line number for the answers section.
 */
function prependQnaToEditFile(filepath: string, questions: string, timestamp: string): number {
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

	const qnaSection = createQnaSection(questions, timestamp);
	const qnaSectionLines = qnaSection.split("\n");

	if (frontmatterEndLine === -1) {
		// No frontmatter - prepend at start
		const newContent = qnaSection + "\n\n" + content;
		writeFileSync(filepath, newContent, "utf-8");
		// Cursor at line after ANSWERS marker
		const questionLines = questions.split("\n").length;
		return 1 + questionLines + 2;
	}

	// Insert after frontmatter
	const beforeFrontmatter = lines.slice(0, frontmatterEndLine + 1);
	const afterFrontmatter = lines.slice(frontmatterEndLine + 1);

	const newLines = [...beforeFrontmatter, "", ...qnaSectionLines, "", ...afterFrontmatter];
	writeFileSync(filepath, newLines.join("\n"), "utf-8");

	// Cursor position:
	// frontmatterEndLine is 0-indexed
	// blank line: frontmatterEndLine + 2 (1-indexed)
	// QUESTIONS marker: frontmatterEndLine + 3
	// questions content: frontmatterEndLine + 4 to frontmatterEndLine + 3 + questionLines
	// ANSWERS marker: frontmatterEndLine + 4 + questionLines
	// cursor (blank for answer): frontmatterEndLine + 5 + questionLines
	const questionLines = questions.split("\n").length;
	return frontmatterEndLine + 5 + questionLines;
}

/**
 * Clean up temp file and directory
 */
function cleanupTempFile(tempFile: string): void {
	try {
		const tempDir = join(tempFile, "..");
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}

export default function qna(pi: ExtensionAPI) {
	// In-memory state for pending questions
	let pendingQuestions: { questions: string; timestamp: string } | null = null;

	/**
	 * Update the status indicator based on pending questions state
	 */
	function updateStatusIndicator(ctx: { ui: { setStatus: (id: string, status: string | undefined) => void } }) {
		if (pendingQuestions) {
			ctx.ui.setStatus("qna", "❓ Questions pending - /answer to respond");
		} else {
			ctx.ui.setStatus("qna", undefined);
		}
	}

	// =========================================================================
	// EVENT: session_start - Reconstruct state from branch history
	// =========================================================================
	pi.on("session_start", async (_event, ctx) => {
		pendingQuestions = null;

		let lastDrafted: { questions: string; timestamp: string } | null = null;
		let wasCleared = false;

		// Walk branch chronologically
		for (const entry of ctx.sessionManager.getBranch()) {
			// Check for draft_questions tool result
			if (entry.type === "message") {
				const msg = entry.message;
				if ("role" in msg && msg.role === "toolResult" && msg.toolName === "draft_questions") {
					const details = msg.details as DraftQuestionsDetails | undefined;
					if (details?.questions) {
						// Backward compat: old entries may not have timestamp, generate one
						const timestamp = details.timestamp || generateTimestamp();
						lastDrafted = { questions: details.questions, timestamp };
						wasCleared = false;
					}
				}
			}

			// Check for qna-clear custom entry
			if (entry.type === "custom" && entry.customType === "qna-clear") {
				wasCleared = true;
			}
		}

		// Restore if questions exist and weren't cleared
		if (lastDrafted && !wasCleared) {
			pendingQuestions = lastDrafted;
		}

		// Update status indicator
		updateStatusIndicator(ctx);
	});

	// =========================================================================
	// EVENT: before_agent_start - Clear questions if user sends new prompt
	// =========================================================================
	pi.on("before_agent_start", async (_event, ctx) => {
		if (pendingQuestions) {
			// Persist the clear so session restore knows questions were skipped
			pi.appendEntry("qna-clear", { reason: "skipped" } as QnaClearData);
			pendingQuestions = null;
			updateStatusIndicator(ctx);
		}
	});

	// =========================================================================
	// TOOL: draft_questions - LLM drafts clarifying questions
	// =========================================================================
	pi.registerTool({
		name: "draft_questions",
		label: "Draft Questions",
		description: `Draft clarifying questions for the user to answer.

Use this when you need user input before proceeding. The user will review your questions and provide responses via the /answer command.

IMPORTANT: Calling this tool OVERWRITES any previously drafted questions. If you have multiple questions, include them all in a single call.

The questions parameter accepts plain text - format them however is clearest (numbered list, bullet points, prose, etc.).`,
		parameters: Type.Object({
			questions: Type.String({
				description: "The clarifying questions for the user, formatted as plain text",
			}),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
			const timestamp = generateTimestamp();
			pendingQuestions = { questions: params.questions, timestamp };
			updateStatusIndicator(ctx);

			return {
				content: [
					{
						type: "text",
						text: "Questions drafted. The user can now run /answer to review and respond.",
					},
				],
				details: { questions: params.questions, timestamp } as DraftQuestionsDetails,
			};
		},

		renderCall(args, theme) {
			const title = theme.fg("toolTitle", theme.bold("draft_questions"));
			return new Text(title, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as DraftQuestionsDetails | undefined;
			if (!details?.questions) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			lines.push(theme.fg("accent", "─".repeat(50)));
			lines.push(theme.fg("accent", theme.bold("📋 Questions for you:")));
			lines.push("");

			// Format each line of questions
			for (const line of details.questions.split("\n")) {
				if (line.trim()) {
					lines.push(theme.fg("text", `  ${line}`));
				} else {
					lines.push("");
				}
			}

			lines.push("");
			lines.push(theme.fg("dim", "  Run /answer to respond"));
			lines.push(theme.fg("accent", "─".repeat(50)));

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	// =========================================================================
	// COMMAND: /questions - View pending questions without opening editor
	// =========================================================================
	pi.registerCommand("questions", {
		description: "View pending clarifying questions",
		handler: async (_args, ctx) => {
			if (!pendingQuestions) {
				ctx.ui.notify("No pending questions", "info");
				return;
			}

			// Display questions using notify for simple cases, or a custom UI for longer content
			const lines = pendingQuestions.questions.split("\n");
			if (lines.length <= 5) {
				ctx.ui.notify(`Pending questions:\n${pendingQuestions.questions}`, "info");
			} else {
				// For longer questions, use a simple select dialog to display them
				// User can press Escape to dismiss
				await ctx.ui.select("Pending Questions (Esc to close)", [
					...lines.filter((l) => l.trim()),
					"─".repeat(40),
					"Run /answer to respond",
				]);
			}
		},
	});

	// =========================================================================
	// COMMAND: /answer - Open editor to answer pending questions
	// =========================================================================
	pi.registerCommand("answer", {
		description: "Answer pending clarifying questions in your editor",
		handler: async (_args, ctx) => {
			// Check for UI availability
			if (!ctx.hasUI) {
				ctx.ui.notify("/answer requires interactive mode", "error");
				return;
			}

			// Check for pending questions
			if (!pendingQuestions) {
				ctx.ui.notify("No pending questions to answer", "warning");
				return;
			}

			const { questions, timestamp } = pendingQuestions;
			const activeEditFile = getActiveEditFile();

			// Determine if using edit file or temp file
			let filepath: string;
			let cursorLine: number;
			let usingTempFile = false;

			if (activeEditFile && existsSync(activeEditFile)) {
				// Prepend Q&A section to the active edit file
				filepath = activeEditFile;
				cursorLine = prependQnaToEditFile(filepath, questions, timestamp);
			} else {
				// Create temp file
				const temp = createTempFile(questions, timestamp);
				filepath = temp.tempFile;
				cursorLine = temp.cursorLine;
				usingTempFile = true;
			}

			try {
				// Open editor
				const exitCode = await openInEditor(filepath, cursorLine, ctx);

				if (exitCode === null) {
					ctx.ui.notify("Editor closed unexpectedly", "warning");
					return;
				}

				// Read and parse the file
				let content: string;
				try {
					content = readFileSync(filepath, "utf-8");
				} catch {
					ctx.ui.notify("Failed to read file after editing", "error");
					return;
				}

				// Verify questions haven't been tampered with
				if (!verifyQnaQuestions(content, timestamp, questions)) {
					ctx.ui.notify("Questions section was modified - please don't edit the questions", "error");
					return;
				}

				// Extract answers
				const answers = extractQnaAnswers(content, timestamp);

				if (!answers) {
					ctx.ui.notify("No response provided - questions remain pending", "warning");
					return;
				}

				// Persist the clear
				pi.appendEntry("qna-clear", { reason: "answered" } as QnaClearData);

				// Clear in-memory state
				pendingQuestions = null;
				updateStatusIndicator(ctx);

				// Send response as user message
				pi.sendUserMessage(answers);
			} finally {
				// Clean up temp file if we created one
				if (usingTempFile) {
					cleanupTempFile(filepath);
				}
			}
		},
	});
}
