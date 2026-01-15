/**
 * WebSearch Tool - Search the web using Exa AI's MCP endpoint
 *
 * Provides real-time web search capabilities for information beyond
 * the model's knowledge cutoff.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { getExaMcpEndpoint } from "./shared/settings-utils.js";
const TIMEOUT_MS = 25000;

interface WebSearchParams {
	query: string;
	numResults?: number;
	type?: "auto" | "fast" | "deep";
	livecrawl?: "fallback" | "preferred";
	contextMaxCharacters?: number;
}

interface WebSearchDetails {
	query: string;
	numResults: number;
	type: string;
	livecrawl: string;
	contextMaxCharacters: number;
	truncated?: boolean;
	originalBytes?: number;
	originalLines?: number;
}

async function performSearch(params: WebSearchParams, signal?: AbortSignal): Promise<string> {
	const EXA_MCP_ENDPOINT = getExaMcpEndpoint();
	const request = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: "web_search_exa",
			arguments: {
				query: params.query,
				type: params.type ?? "auto",
				numResults: params.numResults ?? 8,
				livecrawl: params.livecrawl ?? "fallback",
				contextMaxCharacters: params.contextMaxCharacters ?? 10000,
			},
		},
	};

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

	// Link external signal to our controller
	const abortHandler = () => controller.abort();
	signal?.addEventListener("abort", abortHandler);

	try {
		const response = await fetch(EXA_MCP_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Search failed (${response.status}): ${errorText}`);
		}

		const responseText = await response.text();

		// Parse SSE response - look for data: lines
		const lines = responseText.split("\n");
		for (const line of lines) {
			if (line.startsWith("data: ")) {
				try {
					const data = JSON.parse(line.substring(6));
					if (data.result?.content?.[0]?.text) {
						return data.result.content[0].text;
					}
					if (data.error) {
						throw new Error(`Exa API error: ${data.error.message ?? JSON.stringify(data.error)}`);
					}
				} catch (parseError) {
					if (parseError instanceof SyntaxError) {
						continue; // Try next line
					}
					throw parseError;
				}
			}
		}

		return "No search results found.";
	} catch (error) {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", abortHandler);

		if (error instanceof Error) {
			if (error.name === "AbortError") {
				if (signal?.aborted) {
					throw new Error("Search cancelled");
				}
				throw new Error(`Search request timed out after ${TIMEOUT_MS / 1000}s`);
			}
		}
		throw error;
	} finally {
		signal?.removeEventListener("abort", abortHandler);
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "websearch",
		label: "WebSearch",
		description: `Search the web using Exa AI for real-time information.

Use for:
- Current events and recent news
- Up-to-date documentation or API references
- Information beyond your knowledge cutoff
- Verifying or finding recent data

IMPORTANT: Never include private or sensitive information in search queries
(API keys, passwords, personal identifiable information, internal URLs, credentials, etc.)

Parameters:
- query: The search query (required)
- numResults: Number of results to return (default: 8)
- type: Search depth - "auto" (balanced), "fast" (quick), "deep" (comprehensive)
- livecrawl: "fallback" (use cache, crawl if unavailable) or "preferred" (prioritize fresh content)
- contextMaxCharacters: Maximum characters for context (default: 10000)`,

		parameters: Type.Object({
			query: Type.String({ description: "Web search query" }),
			numResults: Type.Optional(Type.Number({ description: "Number of results (default: 8)" })),
			type: Type.Optional(StringEnum(["auto", "fast", "deep"] as const, { description: "Search type (default: auto)" })),
			livecrawl: Type.Optional(StringEnum(["fallback", "preferred"] as const, { description: "Live crawl mode (default: fallback)" })),
			contextMaxCharacters: Type.Optional(Type.Number({ description: "Max context characters (default: 10000)" })),
		}),

		async execute(toolCallId, params, onUpdate, ctx, signal) {
			const { query, numResults = 8, type = "auto", livecrawl = "fallback", contextMaxCharacters = 10000 } = params as WebSearchParams;

			// Show searching state
			onUpdate?.({
				content: [{ type: "text", text: "Searching..." }],
				details: {
					query,
					numResults,
					type,
					livecrawl,
					contextMaxCharacters,
				} as WebSearchDetails,
			});

			try {
				let result = await performSearch({ query, numResults, type, livecrawl, contextMaxCharacters }, signal);

				// Apply truncation if needed
				const truncation = truncateHead(result, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				const details: WebSearchDetails = {
					query,
					numResults,
					type,
					livecrawl,
					contextMaxCharacters,
					truncated: truncation.truncated,
				};

				if (truncation.truncated) {
					details.originalBytes = truncation.totalBytes;
					details.originalLines = truncation.totalLines;

					result = truncation.content;
					result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
					result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
				}

				return {
					content: [{ type: "text", text: result }],
					details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Search error: ${message}` }],
					details: {
						query,
						numResults,
						type,
						livecrawl,
						contextMaxCharacters,
					} as WebSearchDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const { query, numResults = 8, type = "auto", livecrawl = "fallback" } = args as WebSearchParams;

			let text = theme.fg("toolTitle", "🔍 websearch ");
			text += theme.fg("accent", `"${query}"`);
			text += "\n   " + theme.fg("muted", `${numResults} results, ${type}, ${livecrawl}`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as WebSearchDetails | undefined;

			// Streaming state
			if (isPartial) {
				const query = details?.query ?? "...";
				return new Text(theme.fg("warning", `🔍 Searching for "${query}"...`), 0, 0);
			}

			// Error state
			if (result.isError) {
				const errorText = result.content?.[0]?.type === "text" ? result.content[0].text : "Unknown error";
				return new Text(theme.fg("error", `✗ ${errorText}`), 0, 0);
			}

			// Success state
			const content = result.content?.[0]?.type === "text" ? result.content[0].text : "";

			// Build summary line
			let summary = theme.fg("success", "✓ ");
			summary += theme.fg("muted", `Search results for "${details?.query ?? ""}"`);

			if (details?.truncated) {
				summary += theme.fg("warning", " (truncated)");
			}

			if (!expanded) {
				// Collapsed view - show preview
				const lines = content.split("\n").filter((l) => l.trim());
				const preview = lines.slice(0, 3).join("\n");
				const moreCount = Math.max(0, lines.length - 3);

				let text = summary;
				if (preview) {
					text += "\n" + theme.fg("dim", preview);
				}
				if (moreCount > 0) {
					text += "\n" + theme.fg("muted", `... ${moreCount} more lines (Ctrl+O to expand)`);
				}

				return new Text(text, 0, 0);
			}

			// Expanded view - show full content
			return new Text(summary + "\n" + content, 0, 0);
		},
	});
}
