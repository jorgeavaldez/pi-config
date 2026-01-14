/**
 * Q&A Extension - Draft questions and answer via external editor
 *
 * Provides a tool for the LLM to draft clarifying questions, and a command
 * for the user to answer them in their preferred editor ($EDITOR).
 *
 * Usage:
 *   1. Ask the agent to clarify something - it calls draft_questions
 *   2. Run /answer to open your editor with the questions
 *   3. Write your responses below the "# Answers" section, save and quit
 *   4. Your answers are sent to the LLM as a user message
 *
 * Commands:
 *   /answer    - Open editor to answer pending questions
 *   /questions - View pending questions without opening editor
 *
 * If you send a new prompt without calling /answer, the pending questions
 * are cleared and the conversation continues normally.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DELIMITER = "# Answers";

interface DraftQuestionsDetails {
	questions: string;
}

interface QnaClearData {
	reason: "answered" | "skipped";
}

/**
 * Get the user's preferred editor with fallback chain
 */
function getEditor(): string {
	return process.env.EDITOR || process.env.VISUAL || "nvim" || "vim" || "vi";
}

/**
 * Get editor arguments to position cursor at end of file
 * Supports vim/nvim/vi with + argument
 */
function getEditorArgs(filePath: string): string[] {
	const editor = getEditor();
	const editorName = editor.split("/").pop()?.toLowerCase() || "";

	// vim, nvim, vi all support + to go to last line
	if (editorName.includes("vim") || editorName.includes("vi") || editorName === "nvim") {
		return ["+", filePath];
	}

	// nano supports +line syntax, use a large number to go to end
	if (editorName.includes("nano")) {
		return ["+9999", filePath];
	}

	// emacs supports +line syntax
	if (editorName.includes("emacs")) {
		return ["+9999", filePath];
	}

	// Default: just the file path
	return [filePath];
}

/**
 * Create temp file with questions and delimiter
 */
function createTempFile(questions: string): string {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-qna-"));
	const tempFile = join(tempDir, "questions.md");

	const content = `# Questions

${questions}

${DELIMITER}

`;

	writeFileSync(tempFile, content, "utf-8");
	return tempFile;
}

/**
 * Parse the response from the edited file
 */
function parseResponse(content: string): string | null {
	const delimiterIndex = content.indexOf(DELIMITER);
	if (delimiterIndex === -1) {
		return null;
	}

	const response = content.slice(delimiterIndex + DELIMITER.length).trim();
	return response || null;
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
	let pendingQuestions: string | null = null;

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

		let lastDraftedQuestions: string | null = null;
		let wasCleared = false;

		// Walk branch chronologically
		for (const entry of ctx.sessionManager.getBranch()) {
			// Check for draft_questions tool result
			if (entry.type === "message") {
				const msg = entry.message;
				if ("role" in msg && msg.role === "toolResult" && msg.toolName === "draft_questions") {
					const details = msg.details as DraftQuestionsDetails | undefined;
					if (details?.questions) {
						lastDraftedQuestions = details.questions;
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
		if (lastDraftedQuestions && !wasCleared) {
			pendingQuestions = lastDraftedQuestions;
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
			pendingQuestions = params.questions;
			updateStatusIndicator(ctx);

			return {
				content: [
					{
						type: "text",
						text: "Questions drafted. The user can now run /answer to review and respond.",
					},
				],
				details: { questions: params.questions } as DraftQuestionsDetails,
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
			const lines = pendingQuestions.split("\n");
			if (lines.length <= 5) {
				ctx.ui.notify(`Pending questions:\n${pendingQuestions}`, "info");
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

			const questions = pendingQuestions;
			const tempFile = createTempFile(questions);
			const editor = getEditor();
			const editorArgs = getEditorArgs(tempFile);

			try {
				// Open editor using ctx.ui.custom() to properly suspend/resume TUI
				const response = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
					// Stop TUI to release terminal
					tui.stop();

					// Clear screen
					process.stdout.write("\x1b[2J\x1b[H");

					// Spawn editor with cursor positioning
					const result = spawnSync(editor, editorArgs, {
						stdio: "inherit",
						env: process.env,
					});

					// Restart TUI
					tui.start();
					tui.requestRender(true);

					// Read and parse the file
					let parsedResponse: string | null = null;
					if (result.status === 0) {
						try {
							const content = readFileSync(tempFile, "utf-8");
							parsedResponse = parseResponse(content);
						} catch {
							// File read error - treat as cancelled
						}
					}

					done(parsedResponse);

					// Return empty component (immediately disposed since done() was called)
					return { render: () => [], invalidate: () => {} };
				});

				// Handle the response
				if (response === null) {
					ctx.ui.notify("No response provided - questions remain pending", "warning");
					return;
				}

				// Persist the clear
				pi.appendEntry("qna-clear", { reason: "answered" } as QnaClearData);

				// Clear in-memory state
				pendingQuestions = null;
				updateStatusIndicator(ctx);

				// Send response as user message
				pi.sendUserMessage(response);
			} finally {
				// Clean up temp file
				cleanupTempFile(tempFile);
			}
		},
	});
}
