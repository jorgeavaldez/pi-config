import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEventBus,
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { prepareCompaction } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";

// Exercise the managed extension through Pi's loader/runner and a real local socket.
test("Herdr v9 session reporting and semantic compaction lifecycle", { timeout: 15000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-herdr-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socketPath = process.platform === "win32" ? `${basename(root)}-${process.pid}` : join(root, "herdr.sock");
  const socketEndpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const packets: unknown[] = [];
  let waiting: ((packet: unknown) => void) | undefined;
  const server = net.createServer((socket) => {
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const packet: unknown = JSON.parse(input.slice(0, newline));
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve(packet);
      } else packets.push(packet);
      socket.end("{}\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(socketEndpoint, resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  for (const [key, value] of Object.entries({
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: socketPath,
    HERDR_PANE_ID: "test-pane",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const events = createEventBus();
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL("../herdr-agent-state.ts", import.meta.url))],
    root,
    root,
    events,
  );
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getThinkingLevel = () => "off";
  const models = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const session = SessionManager.inMemory(root);
  session.appendMessage({ role: "user", content: "history to summarize", timestamp: 1 });
  session.appendMessage({ role: "user", content: "more history", timestamp: 2 });
  const prepared = prepareCompaction(session.getBranch(), { enabled: true, reserveTokens: 10, keepRecentTokens: 1 });
  assert.ok(prepared);
  const preparation = prepared;
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, session, new ModelRegistry(models));
  const originalContext = runner.createContext();
  const state: { idle: boolean; file: string | undefined; mode: ExtensionContext["mode"] } = {
    idle: true,
    file: undefined,
    mode: "tui",
  };
  t.mock.method(runner, "createContext", () => ({
    ...originalContext,
    mode: state.mode,
    isIdle: () => state.idle,
  }));
  t.mock.method(session, "getSessionFile", () => state.file);
  const errors: string[] = [];
  runner.onError((error) => errors.push(error.error));

  async function expectPacket(method: string, params: object) {
    const packet = packets.length
      ? packets.shift()
      : await new Promise<unknown>((resolve) => {
          waiting = resolve;
        });
    assert.partialDeepStrictEqual(packet, {
      method,
      params: { pane_id: "test-pane", source: "herdr:pi", agent: "pi", ...params },
    });
  }
  async function expectState(value: "idle" | "working" | "blocked", message?: string) {
    await expectPacket("pane.report_agent", { state: value, ...(message ? { message } : {}) });
  }
  async function startCompaction(reason: SessionBeforeCompactEvent["reason"], controller = new AbortController()) {
    await runner.emit({
      type: "session_before_compact",
      reason,
      willRetry: reason === "overflow",
      signal: controller.signal,
      preparation,
      branchEntries: session.getBranch(),
    });
    return controller;
  }
  async function finishCompaction(
    reason: SessionBeforeCompactEvent["reason"],
    outcome: "success" | "failure" | "cancel",
  ) {
    if (outcome === "success") {
      const id = session.appendCompaction("summary", session.getLeafId(), 100);
      const compactionEntry = session.getEntry(id);
      assert.ok(compactionEntry?.type === "compaction");
      await runner.emit({
        type: "session_compact",
        reason,
        willRetry: reason === "overflow",
        fromExtension: false,
        compactionEntry,
      });
    } else {
      await runner.emit({
        type: "session_compact_failed",
        reason,
        willRetry: false,
        fromExtension: false,
        aborted: outcome === "cancel",
        errorMessage: outcome === "failure" ? "provider failed" : undefined,
      });
    }
  }

  // Headless events and events before TUI startup never claim lifecycle authority.
  await startCompaction("manual");
  state.mode = "rpc";
  await runner.emit({ type: "session_start", reason: "new" });
  await startCompaction("manual");
  state.mode = "tui";
  await runner.emit({ type: "session_start", reason: "new" });
  await expectPacket("pane.report_agent_session", {
    agent_session_id: session.getSessionId(),
    session_start_source: "new",
  });
  await expectState("idle");

  for (const file of ["relative/session.jsonl", "/absolute/session.jsonl", "C:\\sessions\\pi.jsonl"]) {
    await t.test(`v9 session reference: ${file}`, async () => {
      state.file = file;
      await runner.emit({ type: "agent_start" });
      const reference = file.startsWith("relative")
        ? { agent_session_id: session.getSessionId() }
        : { agent_session_path: file };
      await expectPacket("pane.report_agent_session", reference);
      await expectPacket("pane.report_agent", { state: "working", ...reference });
      await runner.emit({ type: "agent_settled", aborted: false });
      await expectState("idle");
    });
  }

  for (const reason of ["manual", "threshold", "overflow"] as const) {
    for (const outcome of ["success", "failure", "cancel"] as const) {
      await t.test(`${reason} compaction: ${outcome}`, async () => {
        if (reason !== "manual") {
          state.idle = false;
          await runner.emit({ type: "agent_start" });
          await expectPacket("pane.report_agent_session", { agent_session_path: state.file });
          await expectState("working");
        }
        const controller = await startCompaction(reason);
        if (reason === "manual") await expectState("working");
        if (outcome === "cancel") {
          controller.abort();
          if (reason === "manual") await expectState("idle");
        }
        await finishCompaction(reason, outcome);
        if (reason === "manual") {
          if (outcome !== "cancel") await expectState("idle");
        } else {
          // A non-idle settlement must not clear the active turn, even after compaction ends.
          await runner.emit({ type: "agent_settled", aborted: false });
          state.idle = true;
          await runner.emit({ type: "agent_settled", aborted: false });
          await expectState("idle");
        }
        // A completed attempt's signal cannot affect a later attempt.
        const next = await startCompaction("manual");
        await expectState("working");
        controller.abort();
        events.emit("herdr:blocked", { active: true, label: "late-abort check" });
        await expectState("blocked", "late-abort check");
        events.emit("herdr:blocked", { active: false });
        await expectState("working");
        next.abort();
        await expectState("idle");
        await finishCompaction("manual", "cancel");
      });
    }
  }

  await t.test("automatic pre-prompt compaction works from idle", async () => {
    await startCompaction("threshold");
    await expectState("working");
    await finishCompaction("threshold", "success");
    await expectState("idle");
  });

  await t.test("blocked precedence and settlement during compaction", async () => {
    await runner.emit({ type: "agent_start" });
    await expectPacket("pane.report_agent_session", { agent_session_path: state.file });
    await expectState("working");
    const controller = await startCompaction("threshold");
    events.emit("herdr:blocked", { active: true, label: "approval" });
    await expectState("blocked", "approval");
    events.emit("herdr:blocked", { active: true, label: "nested" });
    await expectState("blocked", "nested");
    await runner.emit({ type: "agent_settled", aborted: false });
    events.emit("herdr:blocked", { active: false });
    events.emit("herdr:blocked", { active: false });
    await expectState("working");
    controller.abort();
    await expectState("idle");
    await finishCompaction("threshold", "cancel");
  });

  await t.test("compaction cleanup cannot override blocked state", async () => {
    await startCompaction("manual");
    await expectState("working");
    events.emit("herdr:blocked", { active: true, label: "approval" });
    await expectState("blocked", "approval");
    await finishCompaction("manual", "failure");
    events.emit("herdr:blocked", { active: false });
    await expectState("idle");
  });

  await t.test("pre-aborted compaction does not claim working state", async () => {
    const controller = new AbortController();
    controller.abort();
    await startCompaction("manual", controller);
    await finishCompaction("manual", "cancel");
    // The next request must be the session report, not a transient compaction state.
    await runner.emit({ type: "agent_start" });
    await expectPacket("pane.report_agent_session", { agent_session_path: state.file });
    await expectState("working");
    await runner.emit({ type: "agent_settled", aborted: false });
    await expectState("idle");
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(packets, []);
});
