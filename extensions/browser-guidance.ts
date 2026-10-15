/**
 * Lazy agent_browser guidance for stock Pi.
 *
 * pi-agent-browser-native injects its ~36k-char guide into every system prompt
 * unless something answers its `pi:instruction-groups` collector, which only the
 * maintainer's Pi fork does. This answers it for the "browser" group alone and
 * keeps a short, constant pointer in the prompt. The first browser call on a
 * branch is blocked, and the package's live guide is appended to the conversation
 * as a hidden message before the next request. Appending keeps the cached prefix:
 * pi-claude-bridge rebuilds the whole system prompt on any section change.
 *
 * Stopgap: delete once https://github.com/fitchmultz/pi-agent-browser-native/issues/270
 * is fixed upstream.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

const POINTER = `Browser tools (agent_browser and its companions) are available. Their full guide loads into the conversation on first use: the first browser call is blocked once while it loads; then follow the guide and reissue the call.
- Respect explicit stop boundaries. Require explicit authorization for purchases, production-control, destructive or irreversible actions, and account, security, or privacy changes.
- Never attempt CAPTCHA bypass, and do not drive public search-engine forms for discovery.`;
const GUIDE_TYPE = "browser-guidance";

type BrowserGroup = { tools: string[]; instructions: (ctx: ExtensionContext) => string };

function isBrowserGroup(value: unknown): value is BrowserGroup {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		value.name === "browser" &&
		"tools" in value &&
		Array.isArray(value.tools) &&
		value.tools.every((tool) => typeof tool === "string") &&
		"instructions" in value &&
		typeof value.instructions === "function"
	);
}

function hasGuide(entries: SessionEntry[]) {
	return entries.some((entry) => entry.type === "custom_message" && entry.customType === GUIDE_TYPE);
}

function guideMessage(browser: BrowserGroup, ctx: ExtensionContext) {
	return {
		customType: GUIDE_TYPE,
		content: `<agent_browser_guide>\nFull agent_browser guide, loaded on first browser use. It applies for the rest of this conversation.\n\n${browser.instructions(ctx)}\n</agent_browser_guide>`,
		display: false,
	};
}

export default function (pi: ExtensionAPI) {
	// Undefined when the package did not register exactly the browser group: then nothing
	// is claimed and the package keeps injecting its guide eagerly.
	let browser: BrowserGroup | undefined;
	// A browser call was blocked and its guide has not been appended yet.
	let pending = false;

	// The guide was delivered on this branch but compaction dropped it from context.
	function guideCompacted(ctx: ExtensionContext) {
		return hasGuide(ctx.sessionManager.getBranch()) && !hasGuide(ctx.sessionManager.buildContextEntries());
	}

	pi.on("session_start", () => {
		// Collector callbacks must stay synchronous: emit() does not await listeners.
		const groups: unknown[] = [];
		pi.events.emit("pi:instruction-groups", {
			register: (group: unknown) => void groups.push(group),
			isManaged: () => browser !== undefined,
		});
		browser = groups.length === 1 && isBrowserGroup(groups[0]) ? groups[0] : undefined;
		pending = false;
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!browser) return;
		event.systemPromptOptions.sections.agent_browser = POINTER;
		if (guideCompacted(ctx)) return { message: guideMessage(browser, ctx) };
	});

	// Sibling calls in the first batch and nested codemode calls all run before the
	// guide entry exists, so each is blocked.
	pi.on("tool_call", (event, ctx) => {
		if (!browser?.tools.includes(event.toolName) || hasGuide(ctx.sessionManager.getBranch())) return;
		pending = true;
		return {
			block: true,
			reason: "Not run: the agent_browser guide is being added to the conversation first. Read it, then reissue this call.",
		};
	});

	pi.on("turn_end", (_event, ctx) => {
		if (!browser || !(pending || guideCompacted(ctx))) return;
		pending = false;
		return { entries: [{ type: "custom_message", ...guideMessage(browser, ctx) }] };
	});
}
