/**
 * Exa web tools - search and fetch via MCP endpoint
 *
 * Provides real-time web search and webpage fetching capabilities for
 * information beyond the model's knowledge cutoff.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const TIMEOUT_MS = 25000;

interface WebSearchParams {
	query: string;
	numResults?: number;
	type?: "auto" | "fast" | "deep";
	livecrawl?: "fallback" | "preferred";
	contextMaxCharacters?: number;
}

interface WebFetchParams {
	urls: string[];
	maxCharacters?: number;
}

interface ToolResultDetails {
	truncated?: boolean;
	originalBytes?: number;
	originalLines?: number;
}

interface WebSearchDetails extends ToolResultDetails {
	query: string;
	numResults: number;
	type: string;
	livecrawl: string;
	contextMaxCharacters: number;
}

interface WebFetchDetails extends ToolResultDetails {
	urls: string[];
	maxCharacters: number;
}

async function callExaTool(name: string, args: Record<string, unknown>, emptyMessage: string, signal?: AbortSignal): Promise<string> {
	const request = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name,
			arguments: args,
		},
	};

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
			throw new Error(`Request failed (${response.status}): ${errorText}`);
		}

		const responseText = await response.text();
		const lines = responseText.split("\n");
		for (const line of lines) {
			if (!line.startsWith("data: ")) continue;
			try {
				const data = JSON.parse(line.substring(6));
				if (data.result?.content?.[0]?.text) {
					return data.result.content[0].text;
				}
				if (data.error) {
					throw new Error(`Exa API error: ${data.error.message ?? JSON.stringify(data.error)}`);
				}
			} catch (parseError) {
				if (parseError instanceof SyntaxError) continue;
				throw parseError;
			}
		}

		return emptyMessage;
	} catch (error) {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", abortHandler);

		if (error instanceof Error && error.name === "AbortError") {
			if (signal?.aborted) throw new Error("Request cancelled");
			throw new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`);
		}
		throw error;
	} finally {
		signal?.removeEventListener("abort", abortHandler);
	}
}

async function performSearch(params: WebSearchParams, signal?: AbortSignal): Promise<string> {
	return callExaTool(
		"web_search_exa",
		{
			query: params.query,
			type: params.type ?? "auto",
			numResults: params.numResults ?? 8,
			livecrawl: params.livecrawl ?? "fallback",
			contextMaxCharacters: params.contextMaxCharacters ?? 10000,
		},
		"No search results found.",
		signal,
	);
}

async function performFetch(params: WebFetchParams, signal?: AbortSignal): Promise<string> {
	return callExaTool(
		"web_fetch_exa",
		{
			urls: params.urls,
			maxCharacters: params.maxCharacters ?? 3000,
		},
		"No content found.",
		signal,
	);
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
		promptSnippet: "Search the web for current information, recent docs, or facts beyond your knowledge cutoff.",
		promptGuidelines: [
			"Use this tool for recent information, live documentation lookups, or fact verification that may be newer than the model's training data.",
			"Never include secrets, private URLs, credentials, API keys, or other sensitive data in web search queries.",
		],

		parameters: Type.Object({
			query: Type.String({ description: "Web search query" }),
			numResults: Type.Optional(Type.Number({ description: "Number of results (default: 8)" })),
			type: Type.Optional(StringEnum(["auto", "fast", "deep"] as const, { description: "Search type (default: auto)" })),
			livecrawl: Type.Optional(StringEnum(["fallback", "preferred"] as const, { description: "Live crawl mode (default: fallback)" })),
			contextMaxCharacters: Type.Optional(Type.Number({ description: "Max context characters (default: 10000)" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { query, numResults = 8, type = "auto", livecrawl = "fallback", contextMaxCharacters = 10000 } = params as WebSearchParams;

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
				throw new Error(`Search error: ${message}`);
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

			if (isPartial) {
				const query = details?.query ?? "...";
				return new Text(theme.fg("warning", `🔍 Searching for "${query}"...`), 0, 0);
			}

			const isErrorResult = (result as { isError?: boolean }).isError === true;
			if (isErrorResult) {
				const errorText = result.content?.[0]?.type === "text" ? result.content[0].text : "Unknown error";
				return new Text(theme.fg("error", `✗ ${errorText}`), 0, 0);
			}

			const content = result.content?.[0]?.type === "text" ? result.content[0].text : "";

			let summary = theme.fg("success", "✓ ");
			summary += theme.fg("muted", `Search results for "${details?.query ?? ""}"`);

			if (details?.truncated) {
				summary += theme.fg("warning", " (truncated)");
			}

			if (!expanded) {
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

			return new Text(summary + "\n" + content, 0, 0);
		},
	});

	pi.registerTool({
		name: "webfetch",
		label: "WebFetch",
		description: `Fetch full webpage content using Exa AI for one or more known URLs.

Use for:
- Reading the full contents of a page after web search
- Extracting webpage text from known URLs
- Fetching multiple pages in one call

IMPORTANT: Never include private or sensitive URLs, tokens, credentials, or internal-only links.

Parameters:
- urls: URLs to fetch (required)
- maxCharacters: Maximum characters to extract per page (default: 3000)`,
		promptSnippet: "Fetch full webpage content from one or more known URLs.",
		promptGuidelines: [
			"Use this tool when you already have a URL and want the full page contents, especially after websearch.",
			"Batch multiple URLs in one call when useful.",
			"Never include private URLs, credentials, tokens, or other sensitive data in fetched URLs.",
		],

		parameters: Type.Object({
			urls: Type.Array(Type.String({ description: "URL to fetch" }), { description: "URLs to fetch" }),
			maxCharacters: Type.Optional(Type.Number({ description: "Maximum characters per page (default: 3000)" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { urls, maxCharacters = 3000 } = params as WebFetchParams;

			onUpdate?.({
				content: [{ type: "text", text: "Fetching..." }],
				details: {
					urls,
					maxCharacters,
				} as WebFetchDetails,
			});

			try {
				let result = await performFetch({ urls, maxCharacters }, signal);
				const truncation = truncateHead(result, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				const details: WebFetchDetails = {
					urls,
					maxCharacters,
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
				throw new Error(`Fetch error: ${message}`);
			}
		},

		renderCall(args, theme) {
			const { urls, maxCharacters = 3000 } = args as WebFetchParams;
			const firstUrl = urls[0] ?? "";

			let text = theme.fg("toolTitle", "🌐 webfetch ");
			text += theme.fg("accent", firstUrl);
			if (urls.length > 1) {
				text += theme.fg("muted", ` (+${urls.length - 1} more)`);
			}
			text += "\n   " + theme.fg("muted", `max ${maxCharacters} chars/page`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as WebFetchDetails | undefined;

			if (isPartial) {
				const count = details?.urls?.length ?? 0;
				return new Text(theme.fg("warning", `🌐 Fetching ${count} URL${count === 1 ? "" : "s"}...`), 0, 0);
			}

			const isErrorResult = (result as { isError?: boolean }).isError === true;
			if (isErrorResult) {
				const errorText = result.content?.[0]?.type === "text" ? result.content[0].text : "Unknown error";
				return new Text(theme.fg("error", `✗ ${errorText}`), 0, 0);
			}

			const content = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			const count = details?.urls?.length ?? 0;

			let summary = theme.fg("success", "✓ ");
			summary += theme.fg("muted", `Fetched ${count} URL${count === 1 ? "" : "s"}`);

			if (details?.truncated) {
				summary += theme.fg("warning", " (truncated)");
			}

			if (!expanded) {
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

			return new Text(summary + "\n" + content, 0, 0);
		},
	});
}
