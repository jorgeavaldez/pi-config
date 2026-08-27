import net from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const METADATA_SOURCE = "user:pi-compaction";
const ACTIVE_TTL_MS = 15 * 60 * 1000;
const COMPACTION_REASON_LABELS = {
	manual: "Manual",
	threshold: "Automatic",
	overflow: "Overflow recovery",
} as const;

const socketPath = process.env.HERDR_SOCKET_PATH;
const paneId = process.env.HERDR_PANE_ID;
const herdr =
	process.env.HERDR_ENV === "1" && socketPath && paneId
		? {
				paneId,
				socketEndpoint:
					process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath,
			}
		: undefined;

type NotificationSound = "none" | "done" | "request";

function sendRequestAttempt(request: object, timeoutMs: number): Promise<boolean> {
	if (!herdr) return Promise.resolve(true);

	return new Promise((resolve) => {
		const socket = net.createConnection(herdr.socketEndpoint);
		let finished = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const finish = (delivered: boolean) => {
			if (finished) return;
			finished = true;
			if (timeout) clearTimeout(timeout);
			socket.destroy();
			resolve(delivered);
		};

		socket.on("error", () => finish(false));
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", () => finish(true));
		socket.on("end", () => finish(false));
		timeout = setTimeout(() => finish(false), timeoutMs);
		timeout.unref?.();
	});
}

async function deliverRequest(request: object, retryTimeoutMs?: number): Promise<void> {
	if (await sendRequestAttempt(request, 500)) return;
	if (retryTimeoutMs) await sendRequestAttempt(request, retryTimeoutMs);
}

let metadataSeq = Date.now() * 1000;

export default function (pi: ExtensionAPI) {
	if (!herdr) return;
	const herdrPaneId = herdr.paneId;

	let rootSession = false;
	let compactionActive = false;

	function reportCompactionMetadata(value: string | null, ttlMs?: number): void {
		void deliverRequest(
			{
				id: `${METADATA_SOURCE}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
				method: "pane.report_metadata",
				params: {
					pane_id: herdrPaneId,
					source: METADATA_SOURCE,
					clear_state_labels: value === null,
					tokens: { compaction: value },
					seq: ++metadataSeq,
					ttl_ms: ttlMs,
				},
			},
			1500,
		);
	}

	function clearCompactionMetadata(): void {
		reportCompactionMetadata(null);
	}

	function finishCompaction(): void {
		if (!compactionActive) return;
		compactionActive = false;
		clearCompactionMetadata();
	}

	function showNotification(title: string, body: string, sound: NotificationSound): void {
		void deliverRequest({
			id: `${METADATA_SOURCE}:notification:${Date.now()}:${Math.random().toString(36).slice(2)}`,
			method: "notification.show",
			params: { title, body, sound },
		});
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		rootSession = true;
		compactionActive = false;
		clearCompactionMetadata();
	});

	pi.on("session_before_compact", (event) => {
		if (!rootSession) return;

		compactionActive = true;
		reportCompactionMetadata("compacting", ACTIVE_TTL_MS);
		event.signal.addEventListener("abort", finishCompaction, { once: true });
		if (event.signal.aborted) finishCompaction();
	});

	pi.on("session_compact", (event) => {
		if (!rootSession) return;

		finishCompaction();
		showNotification(
			"Pi compaction complete",
			`${COMPACTION_REASON_LABELS[event.reason]} compaction completed${event.willRetry ? "; retrying the turn" : ""}.`,
			"done",
		);
	});

	pi.on("session_compact_failed", (event) => {
		if (!rootSession) return;

		finishCompaction();
		if (event.aborted) {
			showNotification(
				"Pi compaction canceled",
				`${COMPACTION_REASON_LABELS[event.reason]} compaction was canceled.`,
				"none",
			);
			return;
		}

		showNotification(
			"Pi compaction failed",
			event.errorMessage ?? `${COMPACTION_REASON_LABELS[event.reason]} compaction failed.`,
			"request",
		);
	});

	pi.on("session_shutdown", () => {
		if (!rootSession) return;
		if (compactionActive) finishCompaction();
		else clearCompactionMetadata();
		rootSession = false;
	});
}
