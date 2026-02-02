/**
 * Task Tool - Spawn parallel general-purpose subagents with custom prompts
 *
 * Inspired by Claude Code's Task tool from the Agent SDK.
 * Spawns separate `pi` processes for each task, giving isolated context windows.
 *
 * Unlike the subagent tool which requires pre-defined agents, this tool allows
 * the main agent to spawn ad-hoc workers with custom prompts for any task.
 *
 * Use cases:
 *   - Parallel research across different parts of a codebase
 *   - Running multiple independent analyses concurrently
 *   - Divide and conquer for complex multi-part tasks
 *   - Context isolation when working with large files/outputs
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { type ExtensionAPI, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Limits
const MAX_PARALLEL_TASKS = 10;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface TaskResult {
	id: string;
	description: string;
	prompt?: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	cwd?: string;
}

interface TaskDetails {
	mode: "single" | "parallel";
	results: TaskResult[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

function writePromptToTempFile(taskId: string, prompt: string): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-"));
	const safeName = taskId.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

type OnUpdateCallback = (partial: AgentToolResult<TaskDetails>) => void;

async function runTask(
	defaultCwd: string,
	taskId: string,
	description: string,
	prompt: string | undefined,
	cwd: string | undefined,
	tools: string[] | undefined,
	model: string | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: TaskResult[]) => TaskDetails
): Promise<TaskResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];

	// Use specified model or inherit current model
	if (model) args.push("--model", model);

	// If specific tools are requested, limit to those
	if (tools && tools.length > 0) args.push("--tools", tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: TaskResult = {
		id: taskId,
		description,
		prompt,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
		cwd,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		// If a custom prompt is provided, append it as system prompt context
		if (prompt && prompt.trim()) {
			const tmp = writePromptToTempFile(taskId, prompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		// The task description becomes the user message
		args.push(`Task: ${description}`);

		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const proc = spawn("pi", args, { cwd: cwd ?? defaultCwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Task was aborted");
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

// Schema for a single task
const TaskItem = Type.Object({
	description: Type.String({ description: "What this task should accomplish" }),
	prompt: Type.Optional(
		Type.String({ description: "Custom instructions/context for this task (optional system prompt additions)" })
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the task (defaults to current cwd)" })),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Specific tools to enable (defaults to all)" })),
	model: Type.Optional(Type.String({ description: "Model to use for this task (defaults to current model)" })),
});

// Main parameters schema
const TaskParams = Type.Object({
	// Single task mode
	description: Type.Optional(Type.String({ description: "Task description (for single task mode)" })),
	prompt: Type.Optional(Type.String({ description: "Custom instructions for single task" })),
	cwd: Type.Optional(Type.String({ description: "Working directory for single task" })),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Tools for single task" })),
	model: Type.Optional(Type.String({ description: "Model for single task" })),

	// Parallel tasks mode
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of tasks to run in parallel (max 10, 4 concurrent)",
		})
	),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "task",
		label: "Task",
		description: [
			"Spawn general-purpose subagents to handle tasks in isolated context windows.",
			"Use for: parallel research, independent analyses, divide-and-conquer, context isolation.",
			"Each task runs as a separate pi process with full tool access by default.",
			"",
			"Single task: { description: '...' }",
			"Parallel tasks: { tasks: [{ description: '...' }, ...] }",
			"",
			"Optional per-task: prompt (extra instructions), cwd, tools (limit which tools), model.",
			`Max ${MAX_PARALLEL_TASKS} parallel tasks, ${MAX_CONCURRENCY} concurrent.`,
		].join("\n"),
		parameters: TaskParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.description);

			const makeDetails =
				(mode: "single" | "parallel") =>
				(results: TaskResult[]): TaskDetails => ({
					mode,
					results,
				});

			// Validate: must specify exactly one mode
			if (hasTasks && hasSingle) {
				return {
					content: [
						{
							type: "text",
							text: "Invalid parameters: specify either 'description' (single) or 'tasks' array (parallel), not both.",
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (!hasTasks && !hasSingle) {
				return {
					content: [
						{
							type: "text",
							text: "Invalid parameters: provide 'description' for a single task or 'tasks' array for parallel execution.",
						},
					],
					details: makeDetails("single")([]),
				};
			}

			// Parallel mode
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Maximum is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};
				}

				// Track all results for streaming updates
				const allResults: TaskResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					const task = params.tasks[i];
					allResults[i] = {
						id: `task-${i + 1}`,
						description: task.description,
						prompt: task.prompt,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
						cwd: task.cwd,
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [{ type: "text", text: `Tasks: ${done}/${allResults.length} done, ${running} running...` }],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
					const result = await runTask(
						ctx.cwd,
						`task-${index + 1}`,
						task.description,
						task.prompt,
						task.cwd,
						task.tools,
						task.model,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel")
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 200) + (output.length > 200 ? "..." : "");
					return `[Task ${r.id}] ${r.exitCode === 0 ? "✓" : "✗"}: ${r.description}\n${preview || "(no output)"}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `Parallel execution: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			// Single task mode
			if (params.description) {
				const result = await runTask(
					ctx.cwd,
					"task-1",
					params.description,
					params.prompt,
					params.cwd,
					params.tools,
					params.model,
					signal,
					onUpdate,
					makeDetails("single")
				);

				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg = result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Task ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			return {
				content: [{ type: "text", text: "Invalid parameters." }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme) {
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("task ")) + theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
				for (const t of args.tasks.slice(0, 4)) {
					const preview = t.description.length > 50 ? `${t.description.slice(0, 50)}...` : t.description;
					text += `\n  ${theme.fg("dim", "•")} ${theme.fg("toolOutput", preview)}`;
				}
				if (args.tasks.length > 4) {
					text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 4} more`)}`;
				}
				return new Text(text, 0, 0);
			}

			// Single task
			const preview = args.description
				? args.description.length > 70
					? `${args.description.slice(0, 70)}...`
					: args.description
				: "...";
			let text = theme.fg("toolTitle", theme.bold("task "));
			text += theme.fg("toolOutput", preview);
			if (args.prompt) {
				const promptPreview = args.prompt.length > 40 ? `${args.prompt.slice(0, 40)}...` : args.prompt;
				text += `\n  ${theme.fg("dim", "prompt:")} ${theme.fg("muted", promptPreview)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TaskDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			// Single task result
			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold("task"))}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage) {
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					}
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Description ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.description), 0, 0));
					if (r.prompt) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("muted", "─── Prompt ───"), 0, 0));
						container.addChild(new Text(theme.fg("dim", r.prompt), 0, 0));
					}
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0
									)
								);
							}
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				// Collapsed single task
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("task"))}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) {
					text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				} else if (displayItems.length === 0) {
					text += `\n${theme.fg("muted", "(no output)")}`;
				} else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) {
						text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
					}
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			// Parallel results
			const aggregateUsage = (results: TaskResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const failCount = details.results.filter((r) => r.exitCode > 0).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("tasks "))}${theme.fg("accent", status)}`,
							0,
							0
						)
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.id)} ${rIcon}`, 0, 0)
						);
						container.addChild(new Text(theme.fg("dim", r.description), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0
									)
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("tasks "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✓")
								: theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					const descPreview = r.description.length > 60 ? `${r.description.slice(0, 60)}...` : r.description;
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.id)} ${rIcon}`;
					text += `\n${theme.fg("dim", descPreview)}`;
					if (displayItems.length === 0) {
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					} else {
						text += `\n${renderDisplayItems(displayItems, 5)}`;
					}
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
