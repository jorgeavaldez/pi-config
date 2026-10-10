import assert from "node:assert/strict";
import { readFileSync, watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, discoverAndLoadExtensions, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createCodemodeDescription, createCodemodeToolDefinition } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js";
import { wrapToolDefinition } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/tool-definition-wrapper.js";
import { Type } from "typebox";
import { Check } from "typebox/value";

const local = { kind: "local" };
const remote = { kind: "ssh", host: "test-user@exact-host", session: "exact-session" };
const agent = {
  pane_id: "wM:pB", workspace_id: "wM", tab_id: "wM:tC", terminal_id: "term_test",
  cwd: "/task", foreground_cwd: "/task", focused: false, revision: 3,
  agent: "pi", name: "worker", agent_status: "idle", interactive_ready: true,
  agent_session: { source: "herdr:pi", agent: "pi", kind: "path", value: "/task/session.jsonl" },
};
const expected = {
  workspace_id: agent.workspace_id, terminal_id: agent.terminal_id, cwd: agent.cwd, agent_session: agent.agent_session,
};
const promptRequest = { operation: "agent_prompt", pane_id: agent.pane_id, text: "Do the task.", expected, timeout_ms: 5000 };
const sessionList = { sessions: [{ name: remote.session, running: true, default: false, socket_path: "/remote/socket" }] };
const { name: _name, interactive_ready: _ready, ...paneInfo } = agent;
const pane = { ...paneInfo, terminal_title: "ignored", future_field: { arbitrary: true } };
const tab = { tab_id: agent.tab_id, workspace_id: agent.workspace_id, number: 1, label: "Task", focused: false, pane_count: 1, agent_status: "idle" };
const workspace = { workspace_id: agent.workspace_id, active_tab_id: agent.tab_id, number: 1, label: "Task", focused: false, pane_count: 1, tab_count: 1, agent_status: "idle" };
const callsSchema = Type.Array(Type.Object({ program: Type.String(), args: Type.Array(Type.String()), stdin: Type.String() }));
const truncationDetailsSchema = Type.Object({
  fullOutputPath: Type.String(),
  truncation: Type.Object({
    truncated: Type.Literal(true), truncatedBy: Type.Union([Type.Literal("bytes"), Type.Literal("lines")]),
    content: Type.String(), outputLines: Type.Integer(), outputBytes: Type.Integer(),
  }),
});
interface Step { stdout: string; stderr?: string; code?: number; delay_ms?: number; oversized?: boolean }

// The fixture binaries record argv/stdin and return installed-CLI-shaped responses; no live Herdr is called.
test("deferred Herdr tool contract and safety through native Pi", { timeout: 60000, skip: process.platform === "win32" ? "fake herdr/ssh fixtures are POSIX shebang scripts and need zsh" : false }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-herdr-tool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planPath = join(root, "plan.json");
  const countPath = join(root, "count");
  const logPath = join(root, "calls.jsonl");
  const environment = {
    PATH: `${root}:${process.env.PATH}`, HERDR_ENV: "1", HERDR_SOCKET_PATH: join(root, "never-used.sock"),
    HERDR_PANE_ID: "wTest:p1", HERDR_TEST_PLAN: planPath, HERDR_TEST_COUNT: countPath,
    HERDR_TEST_LOG: logPath, HERDR_TEST_ROOT: root,
  };
  for (const [key, value] of Object.entries(environment)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  await writeFile(join(root, "herdr"), `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.HERDR_TEST_LOG, JSON.stringify({program:'herdr', args, stdin:''})+'\\n');
let index = Number(readFileSync(process.env.HERDR_TEST_COUNT, 'utf8'));
writeFileSync(process.env.HERDR_TEST_COUNT, String(index+1));
const step = JSON.parse(readFileSync(process.env.HERDR_TEST_PLAN,'utf8'))[index];
if (!step) { process.stderr.write('unexpected fixture command'); process.exit(99); }
process.stdout.write(step.oversized ? 'x'.repeat(300000) : step.stdout, () => {
  process.stderr.write(step.stderr ?? '', () => setTimeout(() => process.exit(step.code ?? 0), step.delay_ms ?? 0));
});
`);
  await writeFile(join(root, "ssh"), `#!${process.execPath}
import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2), stdin = readFileSync(0,'utf8');
appendFileSync(process.env.HERDR_TEST_LOG,JSON.stringify({program:'ssh',args,stdin})+'\\n');
const result = spawnSync('zsh', ['-f','-c',args.at(-1)], {
  input:stdin, encoding:'utf8', env:{...process.env, ZDOTDIR:process.env.HERDR_TEST_ROOT, HOME:process.env.HERDR_TEST_ROOT}
});
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 255);
`);
  // A login profile may enable errexit: the expected EOF from stdin prompt reading must not stop dispatch.
  await writeFile(join(root, ".zshenv"), "setopt errexit\n");
  await chmod(join(root, "herdr"), 0o755);
  await chmod(join(root, "ssh"), 0o755);
  const loaded = await discoverAndLoadExtensions([fileURLToPath(new URL("../herdr-tool.ts", import.meta.url))], root, root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const models = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), new ModelRegistry(models));
  loaded.runtime.getThinkingLevel = () => "off";
  const registered = runner.getToolDefinition("herdr");
  assert.ok(registered);
  const tool = registered;
  assert.ok(tool.outputSchema);
  const native = wrapToolDefinition(tool, (id, signal) => runner.createToolContext(id, signal));

  async function plan(steps: Step[]) {
    await Promise.all([writeFile(planPath, JSON.stringify(steps)), writeFile(countPath, "0"), writeFile(logPath, "")]);
  }
  async function calls() {
    const raw = (await readFile(logPath, "utf8")).trim();
    const value: unknown = raw ? JSON.parse(`[${raw.split("\n").join(",")}]`) : [];
    assert.ok(Check(callsSchema, value));
    return value;
  }
  async function invoke(args: unknown, signal?: AbortSignal) {
    assert.ok(Check(tool.parameters, args), "test input must match the public schema");
    const result = await native.execute("herdr-test", args, signal);
    assert.ok(tool.outputSchema && Check(tool.outputSchema, result.structuredContent), "every success/error must match outputSchema");
    if (result.details !== undefined) {
      assert.ok(Check(truncationDetailsSchema, result.details));
      const { fullOutputPath } = result.details;
      t.after(() => rm(dirname(fullOutputPath), { recursive: true, force: true }));
    }
    return result;
  }
  function envelope(type: string, fields: object): Step {
    return { stdout: JSON.stringify({ id: "fixture", result: { type, ...fields } }) };
  }

  await t.test("exactly one deferred tool, discoverable namespace, object-root operation union", async () => {
    assert.equal(runner.getAllRegisteredTools().length, 1);
    assert.equal(tool.name, "herdr");
    assert.equal(tool.exposure, "deferred");
    assert.equal(tool.namespace?.name, "herdr");
    assert.ok(tool.namespace?.instructions);
    const description = createCodemodeDescription([native], { deferred: new Set(["herdr"]) });
    assert.equal(description, createCodemodeDescription([]));
    for (const invalid of [
      { route: local, request: { operation: "pane_get", timeout_ms: 1000 } },
      { route: local, request: { operation: "tab_list", timeout_ms: 1000 } },
      { route: { kind: "ssh", host: remote.host }, request: promptRequest },
      { route: { ...remote, host: "-oProxyCommand=oops" }, request: promptRequest },
      { route: local, request: { ...promptRequest, text: "a\0b" } },
      { route: local, request: { operation: "pane_read", pane_id: agent.pane_id, source: "recent", lines: 501, timeout_ms: 1000 } },
      { route: local, request: { operation: "pane_get", pane_id: "focused", timeout_ms: 1000 } },
      { route: local, request: { operation: "pane_get", pane_id: "--current", timeout_ms: 1000 } },
      { route: local, request: { operation: "pane_get", pane_id: "wM:pB;echo unsafe", timeout_ms: 1000 } },
      { route: local, request: { operation: "pane_get", pane_id: agent.pane_id, timeout_ms: 0 } },
      { route: local, request: { operation: "pane_get", pane_id: agent.pane_id, timeout_ms: 30001 } },
      { route: local, request: { operation: "agent_prompt", pane_id: agent.pane_id, text: "task", timeout_ms: 600001, expected } },
      { route: local, request: { operation: "pane_run", pane_id: agent.pane_id, command: "anything" } },
      { route: local, request: { operation: "pane_get", pane_id: agent.pane_id, timeout_ms: 1000, text: "irrelevant" } },
    ]) assert.equal(Check(tool.parameters, invalid), false);
  });

  await t.test("all read operations accept nonnumeric pane IDs and stay explicitly scoped", async () => {
    const cases = [
      { request: { operation: "workspace_list", timeout_ms: 5000 }, response: envelope("workspace_list", { workspaces: [workspace] }), data: { operation: "workspace_list", workspaces: [workspace] }, args: ["workspace", "list"] },
      { request: { operation: "tab_list", workspace_id: agent.workspace_id, timeout_ms: 5000 }, response: envelope("tab_list", { tabs: [tab] }), data: { operation: "tab_list", tabs: [tab] }, args: ["tab", "list", "--workspace", agent.workspace_id] },
      { request: { operation: "pane_list", workspace_id: agent.workspace_id, timeout_ms: 5000 }, response: envelope("pane_list", { panes: [pane] }), data: { operation: "pane_list", panes: [paneInfo] }, args: ["pane", "list", "--workspace", agent.workspace_id] },
      { request: { operation: "pane_get", pane_id: agent.pane_id, timeout_ms: 5000 }, response: envelope("pane_info", { pane }), data: { operation: "pane_get", pane: paneInfo }, args: ["pane", "get", agent.pane_id] },
      { request: { operation: "agent_get", pane_id: agent.pane_id, timeout_ms: 5000 }, response: envelope("agent_info", { agent: { ...agent, future_field: { arbitrary: true } } }), data: { operation: "agent_get", agent }, args: ["agent", "get", agent.pane_id] },
      ...["pane_read", "agent_read"].map((operation) => ({
        request: { operation, pane_id: agent.pane_id, source: "recent-unwrapped", lines: 120, timeout_ms: 5000 },
        response: { stdout: "literal terminal output\n$() `not code`", stderr: "read warning" },
        data: { operation, pane_id: agent.pane_id, source: "recent-unwrapped", lines: 120, text: "literal terminal output\n$() `not code`" },
        args: [operation === "pane_read" ? "pane" : "agent", "read", agent.pane_id, "--source", "recent-unwrapped", "--lines", "120", "--format", "text"],
      })),
    ];
    for (const item of cases) {
      await plan([item.response]);
      const result = await invoke({ route: local, request: item.request });
      assert.equal(result.isError, false);
      assert.partialDeepStrictEqual(result.structuredContent, { ok: true, route: local, data: item.data });
      assert.deepEqual((await calls()).map((call) => call.args), [item.args]);
      assert.equal(JSON.stringify(result.structuredContent).includes("future_field"), false);
      if (item.response.stderr) assert.partialDeepStrictEqual(result.structuredContent, { commands: [{ stage: "request", exit_code: 0, signal: null, stderr: item.response.stderr }] });
    }
  });

  await t.test("model text uses native byte/line truncation and recovery while structured success/errors stay complete", async () => {
    const readRequest = { operation: "pane_read", pane_id: agent.pane_id, source: "visible", lines: 1, timeout_ms: 5000 };
    const unicode = "é".repeat(DEFAULT_MAX_BYTES);
    const manyTabs = Array.from({ length: 230 }, (_, index) => ({ ...tab, tab_id: `wM:t${index}`, label: "", number: index }));
    const stdout = "o".repeat(262144);
    const stderr = "e".repeat(262144);
    for (const item of [
      { request: readRequest, step: { stdout: unicode }, expected: { ok: true, data: { text: unicode } }, limit: "bytes", isError: false },
      { request: { operation: "tab_list", workspace_id: agent.workspace_id, timeout_ms: 5000 }, step: envelope("tab_list", { tabs: manyTabs }), expected: { ok: true, data: { tabs: manyTabs } }, limit: "lines", isError: false },
      { request: readRequest, step: { stdout, stderr, code: 2 }, expected: { ok: false, error: { transport: { stdout, stderr, exit_code: 2 } } }, limit: "bytes", isError: true },
    ]) {
      await plan([item.step]);
      const result = await invoke({ route: local, request: item.request });
      assert.equal(result.isError, item.isError);
      assert.partialDeepStrictEqual(result.structuredContent, item.expected);
      assert.ok(Check(truncationDetailsSchema, result.details));
      const { truncation, fullOutputPath } = result.details;
      assert.equal(truncation.truncatedBy, item.limit);
      assert.ok(truncation.outputBytes <= DEFAULT_MAX_BYTES);
      assert.ok(truncation.outputLines <= DEFAULT_MAX_LINES);
      const content = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      assert.ok(content.startsWith(truncation.content));
      assert.ok(content.includes(fullOutputPath));
      const recovered: unknown = JSON.parse(await readFile(fullOutputPath, "utf8"));
      assert.deepEqual(recovered, result.structuredContent);
    }
  });

  await t.test("local inherited route fails closed without inspecting a focused/default session", async () => {
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH"]) {
      const before = process.env[key];
      delete process.env[key];
      await plan([]);
      const result = await invoke({ route: local, request: { operation: "workspace_list", timeout_ms: 5000 } });
      assert.equal(result.isError, true);
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code: "local_route_unavailable", submission: "not_attempted" } });
      assert.deepEqual(await calls(), []);
      process.env[key] = before;
    }
  });

  await t.test("SSH verifies the exact existing running session, scopes every command, never falls back", async () => {
    await plan([{ stdout: JSON.stringify(sessionList), stderr: "session warning" }, envelope("agent_info", { agent })]);
    delete process.env.HERDR_ENV;
    const result = await invoke({ route: remote, request: { operation: "agent_get", pane_id: agent.pane_id, timeout_ms: 5000 } });
    process.env.HERDR_ENV = "1";
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    assert.partialDeepStrictEqual(result.structuredContent, { commands: [
      { stage: "session_check", stderr: "session warning", exit_code: 0, signal: null },
      { stage: "request", stderr: "", exit_code: 0, signal: null },
    ] });
    const recorded = await calls();
    assert.deepEqual(recorded.filter((call) => call.program === "herdr").map((call) => call.args), [
      ["session", "list", "--json"], ["--session", remote.session, "agent", "get", agent.pane_id],
    ]);
    for (const call of recorded.filter((call) => call.program === "ssh")) {
      assert.equal(call.args.at(-2), remote.host);
      assert.match(call.args.at(-1) ?? "", /^zsh -lic /);
      assert.equal(call.stdin, "");
    }
    await plan([{ stdout: "", stderr: "SSH transport failed", code: 255 }]);
    const unreachable = await invoke({ route: remote, request: { operation: "workspace_list", timeout_ms: 5000 } });
    assert.partialDeepStrictEqual(unreachable.structuredContent, { ok: false, error: { code: "transport_error", stage: "session_check", transport: { exit_code: 255, stderr: "SSH transport failed" } } });
    assert.equal((await calls()).filter((call) => call.program === "herdr").length, 1);
    for (const sessions of [[], [{ name: "other", running: true }], [{ name: remote.session, running: false }]]) {
      await plan([{ stdout: JSON.stringify({ sessions }) }]);
      const failure = await invoke({ route: remote, request: { operation: "workspace_list", timeout_ms: 5000 } });
      assert.partialDeepStrictEqual(failure.structuredContent, { ok: false, error: { code: "session_unavailable" } });
      assert.equal((await calls()).filter((call) => call.program === "herdr").length, 1);
    }
  });

  await t.test("agent_wait observes settled state with a finite default-state wait, not task completion", async () => {
    await plan([envelope("agent_info", { agent: { ...agent, agent_status: "blocked" } })]);
    const result = await invoke({ route: local, request: { operation: "agent_wait", pane_id: agent.pane_id, timeout_ms: 5000 } });
    assert.partialDeepStrictEqual(result.structuredContent, { ok: true, data: { operation: "agent_wait", observation: "current_settled_state", agent: { agent_status: "blocked" } } });
    const args = (await calls())[0]?.args;
    assert.ok(args);
    assert.deepEqual(args.slice(0, 4), ["agent", "wait", agent.pane_id, "--timeout"]);
    assert.ok(Number(args[4]) > 0 && Number(args[4]) <= 5000);
    assert.equal(args.includes("--until"), false);
  });

  await t.test("prompt rejects unsafe readiness, missing sessions, changed identities and the coordinating pane", async () => {
    const unsafeAgents = [
      ...["working", "blocked", "unknown"].map((agent_status) => ({ ...agent, agent_status })),
      { ...agent, interactive_ready: false }, { ...agent, interactive_ready: undefined }, { ...agent, launch_pending: true },
      { ...agent, pane_id: "wTest:p8" }, { ...agent, terminal_id: "replaced" }, { ...agent, cwd: "/other" },
      { ...agent, workspace_id: "wOther" }, { ...agent, agent_session: null },
      { ...agent, agent_session: { ...agent.agent_session, value: "/another-session" } },
      { ...agent, agent: "claude" },
    ];
    for (const current of unsafeAgents) {
      await plan([envelope("agent_info", { agent: current })]);
      const result = await invoke({ route: local, request: promptRequest });
      assert.equal(result.isError, true);
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { stage: "preflight", submission: "not_attempted" } });
      assert.equal((await calls()).length, 1);
    }
    await plan([]);
    const result = await invoke({ route: local, request: { ...promptRequest, pane_id: process.env.HERDR_PANE_ID } });
    assert.partialDeepStrictEqual(result.structuredContent, { error: { code: "self_prompt", submission: "not_attempted" } });
    assert.deepEqual(await calls(), []);
  });

  await t.test("prompt uses installed positional parsing, always waits, and transports hostile text only as data", async () => {
    const text = `--wait\nquotes ' "; $(touch ${join(root, "injected")})\n\u0060touch ${join(root, "injected")}\u0060 $HOME \\ backslash\n\n`;
    for (const route of [local, remote]) {
      for (const finalState of ["done", "idle", "blocked"]) {
        const steps = [envelope("agent_info", { agent: { ...agent, agent_status: "done" } }), envelope("agent_prompted", { agent: { ...agent, agent_status: finalState } })];
        await plan(route.kind === "ssh" ? [{ stdout: JSON.stringify(sessionList) }, ...steps] : steps);
        const result = await invoke({ route, request: { ...promptRequest, text } });
        assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
        assert.partialDeepStrictEqual(result.structuredContent, { ok: true, data: { operation: "agent_prompt", observation: "activity_observed_and_settled", agent: { agent_status: finalState } } });
        const recorded = await calls();
        const prompt = recorded.find((call) => call.program === "herdr" && call.args.includes("prompt"));
        assert.ok(prompt);
        const args = prompt.args.slice(route.kind === "ssh" ? 2 : 0);
        assert.deepEqual(args.slice(0, 6), ["agent", "prompt", agent.pane_id, text, "--wait", "--timeout"]);
        assert.ok(Number(args[6]) > 0 && Number(args[6]) <= 5000);
        assert.equal(args.length, 7);
        for (const call of recorded.filter((call) => call.program === "ssh")) {
          assert.equal(call.args.at(-1)?.includes(text), false);
          if (call.stdin) assert.equal(call.stdin, text);
        }
        await assert.rejects(readFile(join(root, "injected")), /ENOENT/);
      }
    }
  });

  await t.test("server failures, stalled submissions and settled identity errors never trigger resend", async () => {
    for (const code of ["agent_prompt_stalled", "timeout", "agent_blocked"]) {
      await plan([envelope("agent_info", { agent }), { stdout: "", code: 1, stderr: JSON.stringify({ id: "fixture", error: { code, message: "Exact server failure" } }) }]);
      const result = await invoke({ route: local, request: promptRequest });
      assert.equal(result.isError, true);
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code, message: "Exact server failure", submission: "uncertain", transport: { exit_code: 1 } } });
      assert.equal((await calls()).length, 2);
    }
    for (const settled of [{ ...agent, agent_status: "working" }, { ...agent, terminal_id: "replaced" }, { ...agent, agent_session: null }]) {
      await plan([envelope("agent_info", { agent }), envelope("agent_prompted", { agent: settled })]);
      const result = await invoke({ route: local, request: promptRequest });
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code: "identity_or_state_changed", submission: "uncertain" } });
      assert.equal((await calls()).length, 2);
    }
  });

  await t.test("malformed JSON/schema, syntax failures and wrong target data stay structured errors", async () => {
    for (const response of [
      { stdout: "not JSON", stderr: "warning" }, envelope("agent_info", { agent: { ...agent, revision: "3" } }),
      { stdout: "", stderr: "unknown option", code: 2 }, { stdout: "", stderr: "SSH authentication failed", code: 255 },
    ]) {
      await plan([response]);
      const result = await invoke({ route: local, request: { operation: "agent_get", pane_id: agent.pane_id, timeout_ms: 5000 } });
      assert.equal(result.isError, true);
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { submission: "not_attempted", transport: { stdout: response.stdout, stderr: response.stderr ?? "", exit_code: response.code ?? 0 } } });
    }
    await plan([envelope("pane_list", { panes: [{ ...pane, workspace_id: "wOther" }] })]);
    const wrongWorkspace = await invoke({ route: local, request: { operation: "pane_list", workspace_id: agent.workspace_id, timeout_ms: 5000 } });
    assert.partialDeepStrictEqual(wrongWorkspace.structuredContent, { error: { code: "target_mismatch" } });
    await plan([envelope("pane_info", { pane: { ...pane, pane_id: "wTest:p8" } })]);
    const wrongPane = await invoke({ route: local, request: { operation: "pane_get", pane_id: agent.pane_id, timeout_ms: 5000 } });
    assert.partialDeepStrictEqual(wrongPane.structuredContent, { error: { code: "target_mismatch" } });
  });

  await t.test("bounded output, timeout, cancellation and spawn failure preserve transport truth", async () => {
    const request = { operation: "pane_read", pane_id: agent.pane_id, source: "visible", lines: 1, timeout_ms: 50 };
    await plan([{ stdout: "", oversized: true }]);
    const limited = await invoke({ route: local, request: { ...request, timeout_ms: 5000 } });
    assert.equal(limited.isError, true);
    assert.partialDeepStrictEqual(limited.structuredContent, { ok: false, error: { code: "output_limit", transport: { output_limited: true } } });
    await plan([{ stdout: "late output" }]);
    const late = await invoke({ route: local, request: { ...request, timeout_ms: 20 } });
    assert.partialDeepStrictEqual(late.structuredContent, { ok: false, error: { code: "timeout", transport: { exit_code: 0, timed_out: false, stdout: "late output" } } });
    await plan([{ stdout: "partial", stderr: "partial error", delay_ms: 10000 }]);
    const timedOut = await invoke({ route: local, request });
    assert.partialDeepStrictEqual(timedOut.structuredContent, { ok: false, error: { code: "timeout", transport: { stdout: "partial", stderr: "partial error", timed_out: true, exit_code: null, signal: "SIGKILL" } } });
    const abort = new AbortController();
    await plan([{ stdout: "", delay_ms: 10000 }]);
    const watcher = watch(logPath, () => abort.abort());
    try {
      const cancelled = await invoke({ route: local, request: { ...request, timeout_ms: 5000 } }, abort.signal);
      assert.partialDeepStrictEqual(cancelled.structuredContent, { ok: false, error: { code: "cancelled", transport: { cancelled: true, exit_code: null, signal: "SIGKILL" } } });
    } finally { watcher.close(); }
    await plan([envelope("agent_info", { agent }), { stdout: "", delay_ms: 10000 }]);
    const promptAbort = new AbortController();
    const promptWatcher = watch(logPath, () => {
      if (readFileSync(logPath, "utf8").includes('"prompt"')) promptAbort.abort();
    });
    try {
      const cancelled = await invoke({ route: local, request: promptRequest }, promptAbort.signal);
      assert.partialDeepStrictEqual(cancelled.structuredContent, { ok: false, error: { code: "cancelled", submission: "uncertain", transport: { cancelled: true } } });
      assert.equal((await calls()).length, 2);
    } finally { promptWatcher.close(); }
    await plan([]);
    const before = process.env.PATH;
    process.env.PATH = join(root, "missing-bin");
    try {
      const missing = await invoke({ route: local, request });
      assert.partialDeepStrictEqual(missing.structuredContent, { ok: false, error: { code: "transport_error" } });
    } finally { process.env.PATH = before; }
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const cancelled = await invoke({ route: local, request }, alreadyAborted.signal);
    assert.partialDeepStrictEqual(cancelled.structuredContent, { ok: false, error: { code: "cancelled", submission: "not_attempted" } });
  });

  await t.test("native codemode discovers the deferred tool and receives structured success AND error values", async () => {
    const codemode = createCodemodeToolDefinition({ getToolNamespace: (name) => name === "herdr" ? tool.namespace : undefined });
    const input = { route: local, request: { operation: "agent_get", pane_id: agent.pane_id, timeout_ms: 5000 } };
    const nativeContext = {
      ...runner.createToolContext("codemode-test", undefined), tools: [native],
      async executeTool(name: string, args: unknown) {
        assert.equal(name, "herdr");
        assert.deepEqual(args, input);
        const result = await invoke(args);
        return { toolCall: { type: "toolCall" as const, id: "nested", name, arguments: input }, result, isError: result.isError === true };
      },
    };
    const source = `const found = await searchTools('Herdr', {namespace:'herdr'}); if (!found.some(t=>t.name==='herdr')) throw Error('not found'); const ns=await describeNamespace('herdr'); if (!ns.instructions) throw Error('no instructions'); const value=await tools.herdr(${JSON.stringify(input)}); if (typeof value !== 'object') throw Error('text result'); text(value);`;
    for (const step of [envelope("agent_info", { agent }), { stdout: "", code: 1, stderr: JSON.stringify({ id: "fixture", error: { code: "agent_not_found", message: "Gone" } }) }]) {
      await plan([step]);
      const result = await codemode.execute("codemode-test", { code: source }, undefined, undefined, nativeContext);
      assert.notEqual(result.isError, true);
      const content = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      assert.match(content, /Script completed/);
      assert.match(content, step.code === 1 ? /"ok":false/ : /"ok":true/);
    }
  });
});
