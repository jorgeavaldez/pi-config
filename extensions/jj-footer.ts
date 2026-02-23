import { SettingsManager, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 5000;
const JJ_TEMPLATE =
	'change_id.short(8) ++ " " ++ if(bookmarks, bookmarks ++ " ", "") ++ if(description, description.first_line(), "(no description)")';

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts (same behavior as built-in footer)
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let repoRoot: string | null = null;
	let cachedStatus: string | null = null;
	let refreshInFlight: Promise<void> | null = null;
	let lastRefreshAt = 0;
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let requestRender: (() => void) | null = null;

	let settingsManager: SettingsManager | null = null;
	let settingsCwd: string | null = null;
	let autoCompactEnabled = true;
	let lastSettingsRefreshAt = 0;

	function findJjRepoRoot(startCwd: string): string | null {
		let dir = resolve(startCwd);
		while (true) {
			if (existsSync(join(dir, ".jj"))) return dir;
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	}

	function stopStatusRefresh() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	function refreshAutoCompactSetting(cwd: string, force = false): void {
		const now = Date.now();
		if (!force && now - lastSettingsRefreshAt < REFRESH_MS) return;
		lastSettingsRefreshAt = now;

		const previous = autoCompactEnabled;
		try {
			if (!settingsManager || settingsCwd !== cwd) {
				settingsManager = SettingsManager.create(cwd);
				settingsCwd = cwd;
			} else {
				const maybeReload = (settingsManager as { reload?: () => void }).reload;
				if (typeof maybeReload === "function") {
					maybeReload.call(settingsManager);
				} else {
					settingsManager = SettingsManager.create(cwd);
					settingsCwd = cwd;
				}
			}
			autoCompactEnabled = settingsManager.getCompactionEnabled();
		} catch {
			// Keep previous value on errors
		}

		if (autoCompactEnabled !== previous) {
			requestRender?.();
		}
	}

	async function refreshStatus(): Promise<void> {
		if (!enabled || !repoRoot) return;
		if (refreshInFlight) return refreshInFlight;

		refreshInFlight = (async () => {
			const previous = cachedStatus;
			try {
				const { stdout } = await execFileAsync(
					"jj",
					["log", "--no-graph", "-r", "@", "-T", JJ_TEMPLATE],
					{ cwd: repoRoot, timeout: 3000, windowsHide: true },
				);
				cachedStatus = stdout.trim() || null;
			} catch {
				cachedStatus = null;
			} finally {
				lastRefreshAt = Date.now();
				refreshInFlight = null;
			}

			if (cachedStatus !== previous) {
				requestRender?.();
			}
		})();

		return refreshInFlight;
	}

	function scheduleStatusRefresh() {
		stopStatusRefresh();
		if (!enabled || !repoRoot) return;

		if (settingsCwd) refreshAutoCompactSetting(settingsCwd, true);
		void refreshStatus();

		intervalId = setInterval(() => {
			if (settingsCwd) refreshAutoCompactSetting(settingsCwd, true);
			void refreshStatus();
		}, REFRESH_MS);
		intervalId.unref?.();
	}

	function updateRepoContext(cwd: string) {
		settingsCwd = cwd;
		refreshAutoCompactSetting(cwd, true);

		const nextRoot = findJjRepoRoot(cwd);
		if (nextRoot !== repoRoot) {
			repoRoot = nextRoot;
			cachedStatus = null;
			lastRefreshAt = 0;
			if (enabled) {
				scheduleStatusRefresh();
			}
			requestRender?.();
		}
	}

	function setFooter(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		if (!enabled) {
			ctx.ui.setFooter(undefined);
			requestRender = null;
			return;
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const disposeBranchWatcher = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					disposeBranchWatcher();
					requestRender = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model;

					// Calculate cumulative usage from ALL session entries (same as built-in footer)
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;
					let totalCost = 0;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type !== "message") continue;
						const message = entry.message as any;
						if (message?.role !== "assistant" || !message.usage) continue;
						totalInput += message.usage.input;
						totalOutput += message.usage.output;
						totalCacheRead += message.usage.cacheRead;
						totalCacheWrite += message.usage.cacheWrite;
						totalCost += message.usage.cost.total;
					}

					// Calculate context usage from ctx (handles compaction correctly)
					const contextUsage = ctx.getContextUsage();
					const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

					// Keep auto-compaction indicator in sync with settings
					const effectiveSettingsCwd = settingsCwd ?? process.cwd();
					if (Date.now() - lastSettingsRefreshAt > REFRESH_MS) {
						refreshAutoCompactSetting(effectiveSettingsCwd);
					}

					// Replace home directory with ~
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}

					// Branch segment: jj status first, built-in git branch fallback
					if (repoRoot && Date.now() - lastRefreshAt > REFRESH_MS && !refreshInFlight) {
						void refreshStatus();
					}
					const fallbackBranch = footerData.getGitBranch();
					const branch = repoRoot && cachedStatus ? `jj: ${cachedStatus}` : fallbackBranch;
					if (branch) {
						pwd = `${pwd} (${branch})`;
					}

					// Add session name if set
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) {
						pwd = `${pwd} • ${sessionName}`;
					}

					// Truncate path if too long to fit width
					if (pwd.length > width) {
						const half = Math.floor(width / 2) - 2;
						if (half > 1) {
							const start = pwd.slice(0, half);
							const end = pwd.slice(-(half - 1));
							pwd = `${start}...${end}`;
						} else {
							pwd = pwd.slice(0, Math.max(1, width));
						}
					}

					// Build stats line
					const statsParts: string[] = [];
					if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
					if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
					if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
					if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

					// Show cost with "(sub)" indicator if using OAuth subscription
					const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
					if (totalCost || usingSubscription) {
						const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
						statsParts.push(costStr);
					}

					// Colorize context percentage based on usage
					let contextPercentStr: string;
					const autoIndicator = autoCompactEnabled ? " (auto)" : "";
					const contextPercentDisplay =
						contextPercent === "?"
							? `?/${formatTokens(contextWindow)}${autoIndicator}`
							: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
					if (contextPercentValue > 90) {
						contextPercentStr = theme.fg("error", contextPercentDisplay);
					} else if (contextPercentValue > 70) {
						contextPercentStr = theme.fg("warning", contextPercentDisplay);
					} else {
						contextPercentStr = contextPercentDisplay;
					}
					statsParts.push(contextPercentStr);

					let statsLeft = statsParts.join(" ");

					// Add model name on the right side, plus thinking level if model supports it
					const modelName = model?.id || "no-model";
					let statsLeftWidth = visibleWidth(statsLeft);

					// If statsLeft is too wide, truncate it
					if (statsLeftWidth > width) {
						const plainStatsLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
						statsLeft = `${plainStatsLeft.substring(0, width - 3)}...`;
						statsLeftWidth = visibleWidth(statsLeft);
					}

					// Calculate available space for padding (minimum 2 spaces between stats and model)
					const minPadding = 2;

					// Add thinking level indicator if model supports reasoning
					let rightSideWithoutProvider = modelName;
					if (model?.reasoning) {
						const thinkingLevel = pi.getThinkingLevel() || "off";
						rightSideWithoutProvider =
							thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
					}

					// Prepend provider when multiple providers are available and it fits
					let rightSide = rightSideWithoutProvider;
					if (footerData.getAvailableProviderCount() > 1 && model) {
						rightSide = `(${model.provider}) ${rightSideWithoutProvider}`;
						if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
							rightSide = rightSideWithoutProvider;
						}
					}

					const rightSideWidth = visibleWidth(rightSide);
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
						statsLine = statsLeft + padding + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 3) {
							const plainRightSide = rightSide.replace(/\x1b\[[0-9;]*m/g, "");
							const truncatedPlain = plainRightSide.substring(0, availableForRight);
							const padding = " ".repeat(width - statsLeftWidth - truncatedPlain.length);
							statsLine = statsLeft + padding + truncatedPlain;
						} else {
							statsLine = statsLeft;
						}
					}

					// Apply dim to each part separately (same behavior as built-in footer)
					const dimStatsLeft = theme.fg("dim", statsLeft);
					const remainder = statsLine.slice(statsLeft.length);
					const dimRemainder = theme.fg("dim", remainder);

					const lines = [theme.fg("dim", pwd), dimStatsLeft + dimRemainder];

					// Add extension statuses on a single line, sorted by key alphabetically
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sortedStatuses = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeStatusText(text));
						const statusLine = sortedStatuses.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	}

	pi.registerCommand("jj-footer", {
		description: "Toggle JJ footer override (on/off/toggle/status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "status") {
				ctx.ui.notify(`JJ footer is ${enabled ? "enabled" : "disabled"}`, "info");
				return;
			}

			let nextEnabled: boolean;
			if (!arg || arg === "toggle") {
				nextEnabled = !enabled;
			} else if (arg === "on") {
				nextEnabled = true;
			} else if (arg === "off") {
				nextEnabled = false;
			} else {
				ctx.ui.notify("Usage: /jj-footer [on|off|toggle|status]", "warning");
				return;
			}

			if (nextEnabled === enabled) {
				ctx.ui.notify(`JJ footer already ${enabled ? "enabled" : "disabled"}`, "info");
				return;
			}

			enabled = nextEnabled;
			updateRepoContext(ctx.cwd);

			if (enabled) {
				setFooter(ctx);
				scheduleStatusRefresh();
				ctx.ui.notify("JJ footer enabled", "info");
			} else {
				stopStatusRefresh();
				setFooter(ctx);
				ctx.ui.notify("JJ footer disabled (default footer restored)", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		updateRepoContext(ctx.cwd);
		if (enabled) {
			setFooter(ctx);
			scheduleStatusRefresh();
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		updateRepoContext(ctx.cwd);
		if (enabled && !intervalId && repoRoot) {
			scheduleStatusRefresh();
		}
	});

	pi.on("session_shutdown", () => {
		stopStatusRefresh();
		requestRender = null;
	});
}
