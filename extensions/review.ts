/**
 * Code Review Extension (jj-native)
 *
 * Provides a `/review` command that reviews code changes from parent bookmark to current revision.
 * Assumes jj colocated with git.
 *
 * Usage:
 * - `/review` - interactively choose a revset and optional review guidance
 * - `/review <revset>` - use the provided revset as the interactive default
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

// Fresh session review state (module-level — one active review at a time)
let reviewOriginId: string | undefined = undefined;

const DEFAULT_DIFF_REVSET = 'trunk()..@';

const REVIEW_PROMPT =
	"Review the code changes using this exact diff command: `{diffCommand}`. Keep the `--no-integrate-operation` flag so the review does not modify the jj operation log. If no bookmark argument is provided, this range should represent parent bookmark → current revision, even when `@` itself has no bookmark. Provide prioritized, actionable findings.";

const REVIEW_RUBRIC = `# Review Guidelines

You are acting as a code reviewer for a proposed code change.

## What to flag

Flag issues that:
1. Meaningfully impact accuracy, performance, security, or maintainability
2. Are discrete and actionable (not vague or combined issues)
3. Were introduced in the changes being reviewed (not pre-existing)
4. Have provable impact, not speculation
5. The author would likely fix if aware

## Contract & Integration Verification

CRITICAL: Actively verify that changed code aligns with the rest of the codebase and external dependencies. Don't assume—search and confirm.

**Internal codebase contracts:**
- Enum/constant values actually exist and match
- File paths, imports, and references resolve correctly
- Function signatures match (argument order, required params, types)
- Config keys, env vars, schema fields, and model properties exist
- State transitions and preconditions are valid
- Hardcoded strings (filenames, keys, identifiers) match what producers actually write—search for where the string is *produced*, not just consumed

**External dependency contracts:**
- Verify API functions exist and are used correctly (check docs, search the web if needed)
- Confirm method signatures, required parameters, and return types
- Check for deprecated or removed APIs in newer versions
- Validate that expected behaviors match actual library documentation

Web search is acceptable and encouraged when verifying external APIs or dependencies.

## Using Subtasks

For complex reviews, use subtasks to parallelize verification work:
- Spawn subtasks to verify different external APIs or dependencies concurrently
- Use subtasks to search the codebase for contract violations in parallel
- Delegate doc lookups or web searches for multiple libraries simultaneously

This speeds up thorough reviews significantly.

## Review Priorities

1. Call out new dependencies and justify their need
2. Prefer simple solutions over unnecessary abstractions
3. Favor fail-fast over logging-and-continue patterns
4. Flag changes that increase operational risk
5. Errors should be checked by codes/identifiers, not messages

## Priority Levels

- [P0] - Blocking. Drop everything to fix.
- [P1] - Urgent. Address in next cycle.
- [P2] - Normal. Fix eventually.
- [P3] - Low. Nice to have.

## Output format

Provide your findings in a clear, structured format:
1. List each finding with its priority tag, file location, and explanation.
2. Keep line references as short as possible (avoid ranges over 5-10 lines).
3. At the end, provide an overall verdict: "correct" (no blocking issues) or "needs attention" (has blocking issues).
4. Ignore trivial style issues unless they obscure meaning or violate documented standards.

Output all findings the author would fix if they knew about them. If there are no qualifying findings, explicitly state the code looks good. Don't stop at the first finding - list every qualifying issue.`;

const REVIEW_SUMMARY_PROMPT = `We are switching to a coding session to continue working on the code. 
Create a structured summary of this review branch for context when returning later.
	
You MUST summarize the code review that was performed in this branch so that the user can act on it.

1. What was reviewed (files, changes, scope)
2. Key findings and their priority levels (P0-P3)
3. The overall verdict (correct vs needs attention)
4. Any action items or recommendations

YOU MUST append a message with this EXACT format at the end of your summary:

## Next Steps
1. [What should happen next to act on the review]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Code Review Findings

[P0] Short Title

File: path/to/file.ext:line_number

\`\`\`
affected code snippet
\`\`\`

Preserve exact file paths, function names, and error messages.
`;

/**
 * Check if cwd is inside a jj repo
 */
function isJjRepo(cwd: string): boolean {
	let dir = cwd;
	while (true) {
		if (existsSync(join(dir, ".jj"))) return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

export default function reviewExtension(pi: ExtensionAPI) {
	/**
	 * Execute the review
	 */
	async function executeReview(
		ctx: ExtensionCommandContext,
		reviewLabel: string,
		diffCommand: string,
		additionalGuidance: string | undefined,
		useFreshSession: boolean,
	): Promise<void> {
		if (reviewOriginId) {
			ctx.ui.notify("Already in a review. Use /end-review to finish first.", "warning");
			return;
		}

		if (useFreshSession) {
			reviewOriginId = ctx.sessionManager.getLeafId() ?? undefined;

			const entries = ctx.sessionManager.getEntries();
			const firstUserMessage = entries.find(
				(e) => e.type === "message" && e.message.role === "user",
			);

			if (!firstUserMessage) {
				ctx.ui.notify("No user message found in session", "error");
				reviewOriginId = undefined;
				return;
			}

			try {
				const result = await ctx.navigateTree(firstUserMessage.id, { summarize: false, label: "code-review" });
				if (result.cancelled) {
					reviewOriginId = undefined;
					return;
				}
			} catch (error) {
				reviewOriginId = undefined;
				ctx.ui.notify(`Failed to start review: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			ctx.ui.setEditorText("");

			ctx.ui.setWidget("review", (_tui, theme) => {
				const text = new Text(theme.fg("warning", "Review session active, return with /end-review"), 0, 0);
				return {
					render(width: number) {
						return text.render(width);
					},
					invalidate() {
						text.invalidate();
					},
				};
			});
		}

		const prompt = REVIEW_PROMPT.replace(/{diffCommand}/g, diffCommand);
		const guidanceSection = additionalGuidance
			? `\n\nAdditional user guidance:\n\n${additionalGuidance}`
			: "";
		const fullPrompt = `${REVIEW_RUBRIC}\n\n---\n\nPlease perform a code review with the following focus:\n\n${prompt}${guidanceSection}`;

		const modeHint = useFreshSession ? " (fresh session)" : "";
		ctx.ui.notify(`Starting review for ${reviewLabel}${modeHint}`, "info");

		pi.sendUserMessage(fullPrompt);
	}

	// /review [revset]
	pi.registerCommand("review", {
		description: "Review code changes with an interactive revset and optional guidance prompt.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Review requires interactive mode", "error");
				return;
			}

			if (reviewOriginId) {
				ctx.ui.notify("Already in a review. Use /end-review to finish first.", "warning");
				return;
			}

			if (!isJjRepo(ctx.cwd)) {
				ctx.ui.notify("Not a jj repository", "error");
				return;
			}

			let revsetInput = args.trim() || DEFAULT_DIFF_REVSET;
			while (true) {
				const editedRevset = await ctx.ui.editor("Review revset", revsetInput);
				if (editedRevset === undefined) {
					if (revsetInput) {
						revsetInput = "";
						continue;
					}

					ctx.ui.notify("Review cancelled", "info");
					return;
				}

				revsetInput = editedRevset.trim();
				break;
			}

			if (!revsetInput) {
				ctx.ui.notify("Review cancelled", "info");
				return;
			}

			const guidanceInput = await ctx.ui.editor("Additional review guidance (optional)");
			if (guidanceInput === undefined) {
				ctx.ui.notify("Review cancelled", "info");
				return;
			}

			const revset = revsetInput;
			const additionalGuidance = guidanceInput.trim() || undefined;
			const quotedRevset = `'${revset.replace(/'/g, "'\\''")}'`;
			const diffCommand = `jj --no-integrate-operation diff -r ${quotedRevset}`;
			const reviewLabel = `revset '${revset}'`;

			// Determine fresh session mode
			const entries = ctx.sessionManager.getEntries();
			const messageCount = entries.filter((e) => e.type === "message").length;

			let useFreshSession = false;

			if (messageCount > 0) {
				const choice = await ctx.ui.select("Start review in:", ["Empty branch", "Current session"]);
				if (choice === undefined) {
					ctx.ui.notify("Review cancelled", "info");
					return;
				}
				useFreshSession = choice === "Empty branch";
			}

			await executeReview(ctx, reviewLabel, diffCommand, additionalGuidance, useFreshSession);
		},
	});

	// /end-review
	pi.registerCommand("end-review", {
		description: "Complete review and return to original position",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("End-review requires interactive mode", "error");
				return;
			}

			if (!reviewOriginId) {
				ctx.ui.notify("Not in a review branch (use /review first, or review was started in current session mode)", "info");
				return;
			}

			const summaryChoice = await ctx.ui.select("Summarize review branch?", [
				"Summarize",
				"No summary",
			]);

			if (summaryChoice === undefined) {
				ctx.ui.notify("Cancelled. Use /end-review to try again.", "info");
				return;
			}

			const wantsSummary = summaryChoice === "Summarize";
			const originId = reviewOriginId;

			if (wantsSummary) {
				const result = await ctx.ui.custom<{ cancelled: boolean; error?: string } | null>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, "Summarizing review branch...");
					loader.onAbort = () => done(null);

					ctx.navigateTree(originId!, {
						summarize: true,
						customInstructions: REVIEW_SUMMARY_PROMPT,
						replaceInstructions: true,
					})
						.then(done)
						.catch((err) => done({ cancelled: false, error: err instanceof Error ? err.message : String(err) }));

					return loader;
				});

				if (result === null) {
					ctx.ui.notify("Summarization cancelled. Use /end-review to try again.", "info");
					return;
				}

				if (result.error) {
					ctx.ui.notify(`Summarization failed: ${result.error}`, "error");
					return;
				}

				ctx.ui.setWidget("review", undefined);
				reviewOriginId = undefined;

				if (result.cancelled) {
					ctx.ui.notify("Navigation cancelled", "info");
					return;
				}

				if (!ctx.ui.getEditorText().trim()) {
					ctx.ui.setEditorText("Act on the code review");
				}

				ctx.ui.notify("Review complete! Returned to original position.", "info");
			} else {
				try {
					const result = await ctx.navigateTree(originId!, { summarize: false });

					if (result.cancelled) {
						ctx.ui.notify("Navigation cancelled. Use /end-review to try again.", "info");
						return;
					}

					ctx.ui.setWidget("review", undefined);
					reviewOriginId = undefined;
					ctx.ui.notify("Review complete! Returned to original position.", "info");
				} catch (error) {
					ctx.ui.notify(`Failed to return: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
			}
		},
	});
}
