/**
 * Notification Extension
 *
 * Notification backend priority (checked once at module load):
 * 1) Pi Agent.app (if installed)
 * 2) osascript (native macOS notifications)
 * 3) OSC 777 in WezTerm
 * 4) no-op
 */

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type NotifyFn = (title: string, body: string) => void;

const APP_BUNDLE_NAME = "Pi Agent.app";
const APP_PATH_CANDIDATES = [
	`/Applications/${APP_BUNDLE_NAME}`,
	process.env.HOME ? `${process.env.HOME}/Applications/${APP_BUNDLE_NAME}` : null,
].filter((path): path is string => path !== null);

function findCommand(command: string): string | null {
	try {
		const result = spawnSync("which", [command], {
			encoding: "utf-8",
			timeout: 1000,
		});
		if (result.status !== 0) return null;
		const path = result.stdout.trim();
		return path.length > 0 ? path : null;
	} catch {
		return null;
	}
}

function spawnDetached(command: string, args: string[]): void {
	try {
		const child = spawn(command, args, {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// Ignore notification delivery failures.
	}
}

function resolveNotifier(): NotifyFn {
	const appBundlePath = APP_PATH_CANDIDATES.find((path) => existsSync(path));
	const osascriptPath = findCommand("osascript");

	if (appBundlePath && osascriptPath) {
		return (title, body) => {
			// Matches the known-working invocation:
			// osascript /Applications/Pi\ Agent.app "message" "title"
			spawnDetached(osascriptPath, [appBundlePath, body, title]);
		};
	}

	if (appBundlePath) {
		const appletPath = join(appBundlePath, "Contents", "MacOS", "applet");
		if (existsSync(appletPath)) {
			return (title, body) => {
				spawnDetached(appletPath, [body, title]);
			};
		}
	}

	if (osascriptPath) {
		return (title, body) => {
			spawnDetached(osascriptPath, [
				"-e",
				"on run argv",
				"-e",
				"set msg to item 1 of argv",
				"-e",
				"set ttl to item 2 of argv",
				"-e",
				"display notification msg with title ttl",
				"-e",
				"end run",
				"--",
				body,
				title,
			]);
		};
	}

	if (process.env.TERM_PROGRAM === "WezTerm") {
		return (title, body) => {
			process.stderr.write(`\x1b]777;notify;${title};${body}\x07`);
		};
	}

	return () => {};
}

const notify = resolveNotifier();

export default function (pi: ExtensionAPI) {
	// Notify when agent finishes and is ready for input
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		notify("pi", "Ready for input");
	});

	// Notify when a potentially dangerous tool call is made
	pi.on("tool_call", async (event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}

		const { toolName, input } = event;

		// Check for dangerous bash commands
		if (toolName === "bash" && input.command) {
			const cmd = input.command as string;
			const dangerous = ["rm -rf", "sudo", "chmod", "chown", "mkfs", "dd if="].some(
				(pattern) => cmd.includes(pattern)
			);

			if (dangerous) {
				notify("pi", `Dangerous command: ${cmd.substring(0, 50)}...`);
			}
		}
	});
}
