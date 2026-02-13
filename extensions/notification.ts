/**
 * WezTerm Notification Extension
 *
 * Sends desktop notifications via OSC 777 escape sequence when:
 * - Agent finishes and is ready for input
 * - Permission is requested for dangerous operations
 *
 * Supported terminals: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * Not supported: Kitty (uses OSC 99), Terminal.app, Windows Terminal, Alacritty
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SUPPORTED_TERMINALS = ["WezTerm"];

/**
 * Send a desktop notification via OSC 777 escape sequence.
 * Writes to stderr to avoid corrupting stdout-based protocols (RPC, JSON mode).
 */
function notify(title: string, body: string): void {
	// OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
	process.stderr.write(`\x1b]777;notify;${title};${body}\x07`);
}

export default function (pi: ExtensionAPI) {
	const term = process.env.TERM_PROGRAM ?? "";
	if (!SUPPORTED_TERMINALS.includes(term)) return;
	// Notify when agent finishes and is ready for input
	pi.on("agent_end", async () => {
		notify("pi", "Ready for input");
	});

	// Notify when a potentially dangerous tool call is made
	pi.on("tool_call", async (event) => {
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
