import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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
const launchRequest = {
  operation: "agent_launch", location: { kind: "workspace", label: "Task" }, cwd: agent.cwd, name: "worker",
  harness: { kind: "pi", model: "provider/model:high" },
};
const owned = [{ pane_id: agent.pane_id, terminal_id: agent.terminal_id, agent_session: agent.agent_session }];
const retireWorkspace = { target: { kind: "workspace", workspace_id: agent.workspace_id }, panes: owned };
const retireTab = { target: { kind: "tab", workspace_id: agent.workspace_id, tab_id: agent.tab_id }, panes: owned };
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
test("deferred Herdr tool contract and safety through native Pi", { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-herdr-tool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planPath = join(root, "plan.json");
  const countPath = join(root, "count");
  const logPath = join(root, "calls.jsonl");
  const windows = process.platform === "win32";
  const windowsDirectory = process.env.windir;
  const environment = {
    PATH: `${root}${delimiter}${process.env.PATH}`, HERDR_ENV: "1", HERDR_SOCKET_PATH: join(root, "never-used.sock"),
    HERDR_PANE_ID: "wTest:p1", HERDR_TEST_PLAN: planPath, HERDR_TEST_COUNT: countPath,
    HERDR_TEST_LOG: logPath,
    // Windows: the tool must take ssh from %windir%\System32\OpenSSH, never from PATH, so that is where
    // the fixture lives; a real ssh earlier on PATH would fail every SSH-route assertion below.
    ...(windows ? { windir: root } : {}),
  };
  for (const [key, value] of Object.entries(environment)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  // POSIX runs the fixtures as shebang scripts. Windows resolves only real executables, so each is built
  // as a Node single executable, which also passes option-first argv through untouched.
  async function install(directory: string, name: string, source: string) {
    await mkdir(directory, { recursive: true });
    if (!windows) {
      await writeFile(join(directory, name), `#!${process.execPath}\n${source}`);
      await chmod(join(directory, name), 0o755);
      return;
    }
    const main = join(root, `${name}.cjs`);
    const config = join(root, `${name}.sea.json`);
    await writeFile(main, source);
    await writeFile(config, JSON.stringify({ main, output: join(directory, `${name}.exe`), disableExperimentalSEAWarning: true }));
    execFileSync(process.execPath, [`--build-sea=${config}`], { stdio: "ignore" });
  }
  // The remote login shell is zsh. Without one on Windows, Git's bash stands in for both the shell sshd
  // starts and the `zsh -lic` it is asked to run; errexit stays on, as the .zshenv below does for zsh.
  let remoteShell = ["zsh", "-f", "-c"];
  let remoteEnvironment: Record<string, string> = { ZDOTDIR: root, HOME: root };
  if (windows) {
    assert.ok(windowsDirectory);
    // Same order Pi uses for its own Bash: Git Bash under Program Files, then bash.exe on PATH.
    const bash = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].map((base) => `${base}\\Git\\bin\\bash.exe`)
      .concat((process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, "bash.exe"))).find((candidate) => existsSync(candidate));
    assert.ok(bash, "the Windows SSH fixture needs Git Bash or another bash.exe on PATH");
    remoteShell = [bash, "-c"];
    remoteEnvironment = { HOME: root, windir: windowsDirectory, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" };
    await writeFile(join(root, "zsh"), '#!/bin/sh\n[ "$1" = -lic ] || exit 64\nexec bash -e -c "$2"\n');
  }
  await install(root, "herdr", `
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
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
  await install(windows ? join(root, "System32", "OpenSSH") : root, "ssh", `
const { readFileSync, appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), stdin = readFileSync(0,'utf8');
appendFileSync(process.env.HERDR_TEST_LOG,JSON.stringify({program:'ssh',args,stdin})+'\\n');
const [shell, ...flags] = ${JSON.stringify(remoteShell)};
const result = spawnSync(shell, [...flags, args.at(-1)], {
  input:stdin, encoding:'utf8', env:{...process.env, ...${JSON.stringify(remoteEnvironment)}}
});
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 255);
`);
  // A login profile may enable errexit: the expected EOF from stdin prompt reading must not stop dispatch.
  await writeFile(join(root, ".zshenv"), "setopt errexit\n");
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
      { route: local, request: { ...launchRequest, harness: { kind: "pi" } } },
      { route: local, request: { ...launchRequest, harness: { kind: "pi", model: "any", intent: "planning" } } },
      { route: local, request: { ...launchRequest, harness: { kind: "claude", model: "opus", intent: "bypassPermissions" } } },
      { route: local, request: { ...launchRequest, harness: { kind: "claude", model: "opus", args: ["--dangerously-skip-permissions"] } } },
      { route: local, request: { ...launchRequest, cwd: "task" } },
      { route: local, request: { ...launchRequest, cwd: "~/task" } },
      { route: local, request: { ...launchRequest, cwd: "C:task" } },
      { route: local, request: { operation: "task_retire", ...retireWorkspace, panes: [{ pane_id: agent.pane_id, terminal_id: agent.terminal_id }] } },
      { route: local, request: { ...launchRequest, harness: { kind: "pi", model: "--dangerous" } } },
      { route: local, request: { ...launchRequest, harness: { kind: "codex", model: "any" } } },
      { route: local, request: { ...launchRequest, location: { kind: "workspace", label: "--focus" } } },
      { route: local, request: { ...launchRequest, location: { kind: "tab", label: "Task" } } },
      { route: local, request: { ...launchRequest, cwd: "--focus" } },
      { route: local, request: { ...launchRequest, name: "Worker" } },
      { route: local, request: { ...launchRequest, args: ["--anything"] } },
      { route: local, request: { ...launchRequest, timeout_ms: 1000 } },
      { route: local, request: { operation: "task_retire", ...retireWorkspace, panes: [] } },
      { route: local, request: { operation: "task_retire", target: { kind: "tab", workspace_id: agent.workspace_id }, panes: owned } },
      { route: local, request: { operation: "task_retire", target: retireWorkspace.target } },
    ]) assert.equal(Check(tool.parameters, invalid), false);
    for (const valid of [
      { route: local, request: { operation: "pane_get", pane_id: agent.pane_id } },
      { route: local, request: { operation: "agent_prompt", pane_id: agent.pane_id, text: "task", expected } },
      { route: remote, request: { ...launchRequest, cwd: "C:\\Users\\task dir", harness: { kind: "claude", model: "opus[1m]", intent: "planning" } } },
      { route: local, request: { ...launchRequest, cwd: "C:/Users/task" } },
    ]) assert.equal(Check(tool.parameters, valid), true);
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
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code: "local_route_unavailable", mutations: { submission: "not_attempted" } } });
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
    const transported = recorded.filter((call) => call.program === "ssh");
    assert.deepEqual(transported.map((call) => call.args), [
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", remote.host, "zsh -lic 'exec '\\''herdr'\\'' '\\''session'\\'' '\\''list'\\'' '\\''--json'\\'''"],
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", remote.host, `zsh -lic 'exec '\\''herdr'\\'' '\\''--session'\\'' '\\''${remote.session}'\\'' '\\''agent'\\'' '\\''get'\\'' '\\''${agent.pane_id}'\\'''`],
    ]);
    for (const call of transported) assert.equal(call.stdin, "");
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
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { stage: "preflight", mutations: { submission: "not_attempted" } } });
      assert.equal((await calls()).length, 1);
    }
    await plan([]);
    const result = await invoke({ route: local, request: { ...promptRequest, pane_id: process.env.HERDR_PANE_ID } });
    assert.partialDeepStrictEqual(result.structuredContent, { error: { code: "self_prompt", mutations: { submission: "not_attempted" } } });
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
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code, message: "Exact server failure", mutations: { submission: "uncertain" }, transport: { exit_code: 1 } } });
      assert.equal((await calls()).length, 2);
    }
    for (const settled of [{ ...agent, agent_status: "working" }, { ...agent, terminal_id: "replaced" }, { ...agent, agent_session: null }]) {
      await plan([envelope("agent_info", { agent }), envelope("agent_prompted", { agent: settled })]);
      const result = await invoke({ route: local, request: promptRequest });
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { code: "identity_or_state_changed", mutations: { submission: "applied" } } });
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
      assert.partialDeepStrictEqual(result.structuredContent, { ok: false, error: { mutations: { submission: "not_attempted" }, transport: { stdout: response.stdout, stderr: response.stderr ?? "", exit_code: response.code ?? 0 } } });
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
      assert.partialDeepStrictEqual(cancelled.structuredContent, { ok: false, error: { code: "cancelled", mutations: { submission: "uncertain" }, transport: { cancelled: true } } });
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
    assert.partialDeepStrictEqual(cancelled.structuredContent, { ok: false, error: { code: "cancelled", mutations: { submission: "not_attempted" } } });
  });

  await t.test("launch creates the unfocused task location, starts the harness with its intent and returns handles that prompt and retire accept", async () => {
    const claudeSession = { source: "herdr:claude", agent: "claude", kind: "id", value: "conversation-1" };
    const claude = { ...agent, agent: "claude", agent_session: claudeSession };
    for (const item of [
      { location: launchRequest.location, type: "workspace_created", create: ["workspace", "create"], target: retireWorkspace.target, close: ["workspace", "close", agent.workspace_id],
        harness: launchRequest.harness, current: agent, native: ["--model", "provider/model:high"] },
      { location: { kind: "tab", workspace_id: agent.workspace_id, label: "Review" }, type: "tab_created", create: ["tab", "create", "--workspace", agent.workspace_id], target: retireTab.target, close: ["tab", "close", agent.tab_id],
        harness: { kind: "claude", model: "opus" }, current: claude, native: ["--model", "opus", "--permission-mode", "auto"] },
      { location: launchRequest.location, type: "workspace_created", create: ["workspace", "create"], target: retireWorkspace.target, close: ["workspace", "close", agent.workspace_id],
        harness: { kind: "claude", model: "opus", intent: "implementation" }, current: claude, native: ["--model", "opus", "--permission-mode", "auto"] },
      { location: launchRequest.location, type: "workspace_created", create: ["workspace", "create"], target: retireWorkspace.target, close: ["workspace", "close", agent.workspace_id],
        harness: { kind: "claude", model: "opus", intent: "planning" }, current: claude, native: ["--model", "opus", "--permission-mode", "plan"] },
    ]) {
      const session = item.current.agent_session;
      const handle = { target: item.target, panes: [{ pane_id: agent.pane_id, terminal_id: agent.terminal_id, agent_session: session }] };
      const identity = { ...expected, agent_session: session };
      // The fresh read may spell the same directory with a trailing separator; nothing else is tolerated.
      await plan([envelope(item.type, { workspace, tab, root_pane: pane }), envelope("agent_started", { agent: item.current, argv: ["ignored"] }), envelope("agent_info", { agent: { ...item.current, cwd: `${agent.cwd}/` } })]);
      const result = await invoke({ route: local, request: { ...launchRequest, location: item.location, harness: item.harness } });
      assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
      assert.partialDeepStrictEqual(result.structuredContent, { ok: true, data: { operation: "agent_launch", agent: { agent: item.harness.kind }, expected: { ...identity, cwd: `${agent.cwd}/` }, retire: handle, task: "not_requested" } });
      const recorded = (await calls()).map((call) => call.args);
      assert.deepEqual(recorded[0], [...item.create, "--cwd", agent.cwd, "--label", item.location.label, "--no-focus"]);
      const start = recorded[1];
      assert.ok(start);
      assert.deepEqual(start.slice(0, 8), ["agent", "start", "worker", "--kind", item.harness.kind, "--pane", agent.pane_id, "--timeout"]);
      assert.ok(Number(start[8]) > 0 && Number(start[8]) <= 60000);
      assert.deepEqual(start.slice(9), ["--", ...item.native]);
      assert.deepEqual(recorded.slice(2), [["agent", "get", agent.pane_id]]);
      await plan([envelope("agent_info", { agent: item.current }), envelope("agent_prompted", { agent: { ...item.current, agent_status: "done" } })]);
      const followUp = await invoke({ route: local, request: { operation: "agent_prompt", pane_id: agent.pane_id, text: "Follow up.", expected: identity } });
      assert.equal(followUp.isError, false, JSON.stringify(followUp.structuredContent));
      const live = { ...pane, agent: item.current.agent, agent_session: session, agent_status: "done" };
      const elsewhere = { ...pane, pane_id: "wM:pZ", tab_id: "wM:tOther", terminal_id: "term_other", agent_status: "working" };
      await plan([envelope("pane_list", { panes: item.target.kind === "tab" ? [live, elsewhere] : [live] }), envelope("ok", {})]);
      const retired = await invoke({ route: local, request: { operation: "task_retire", ...handle } });
      assert.equal(retired.isError, false, JSON.stringify(retired.structuredContent));
      assert.partialDeepStrictEqual(retired.structuredContent, { ok: true, data: { operation: "task_retire", ...handle } });
      assert.deepEqual((await calls()).map((call) => call.args), [["pane", "list", "--workspace", agent.workspace_id], item.close]);
    }
  });

  await t.test("launch waits out a new pane whose shell is not at its prompt yet, since that rejection starts nothing", async () => {
    const busy = { stdout: "", code: 1, stderr: JSON.stringify({ id: "fixture", error: { code: "agent_pane_busy", message: "agent target pane is not an available shell" } }) };
    await plan([envelope("workspace_created", { workspace, tab, root_pane: pane }), busy, envelope("agent_started", { agent, argv: [] }), envelope("agent_info", { agent })]);
    const result = await invoke({ route: local, request: launchRequest });
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    assert.deepEqual((await calls()).map((call) => call.args.slice(0, 2)), [["workspace", "create"], ["agent", "start"], ["agent", "start"], ["agent", "get"]]);
  });

  await t.test("launch with a task submits it as data after verification and reports the settled observation on both routes", async () => {
    const text = `--wait\nquotes ' "; $(touch ${join(root, "launched")})\n`;
    for (const route of [local, remote]) {
      const steps = [
        envelope("workspace_created", { workspace, tab, root_pane: pane }), envelope("agent_started", { agent, argv: [] }),
        envelope("agent_info", { agent }), envelope("agent_prompted", { agent: { ...agent, agent_status: "blocked" } }),
      ];
      await plan(route.kind === "ssh" ? [{ stdout: JSON.stringify(sessionList) }, ...steps] : steps);
      const result = await invoke({ route, request: { ...launchRequest, location: { kind: "workspace", label: "Task's \"label\"" }, task: { text, timeout_ms: 5000 } } });
      assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
      assert.partialDeepStrictEqual(result.structuredContent, { ok: true, data: { task: "activity_observed_and_settled", expected, retire: retireWorkspace, agent: { agent_status: "blocked" } } });
      const recorded = await calls();
      const scope = route.kind === "ssh" ? ["--session", remote.session] : [];
      const herdr = recorded.filter((call) => call.program === "herdr").map((call) => call.args).slice(route.kind === "ssh" ? 1 : 0);
      assert.deepEqual(herdr[0], [...scope, "workspace", "create", "--cwd", agent.cwd, "--label", "Task's \"label\"", "--no-focus"]);
      assert.deepEqual(herdr.slice(1).map((args) => args.slice(0, scope.length + 2)), [[...scope, "agent", "start"], [...scope, "agent", "get"], [...scope, "agent", "prompt"]]);
      assert.deepEqual(herdr[1]?.slice(-3), ["--", "--model", "provider/model:high"]);
      const prompt = herdr[3]?.slice(scope.length);
      assert.ok(prompt);
      assert.deepEqual(prompt.slice(0, 6), ["agent", "prompt", agent.pane_id, text, "--wait", "--timeout"]);
      assert.ok(Number(prompt[6]) > 0 && Number(prompt[6]) <= 5000);
      const transported = recorded.filter((call) => call.program === "ssh");
      assert.equal(transported.length, route.kind === "ssh" ? 5 : 0);
      // Only the prompt travels on stdin; no remote command line ever contains it.
      assert.deepEqual(transported.map((call) => call.stdin), route.kind === "ssh" ? ["", "", "", "", text] : []);
      for (const call of transported) assert.equal(call.args.at(-1)?.includes("touch"), false);
      await assert.rejects(readFile(join(root, "launched")), /ENOENT/);
    }
  });

  await t.test("an unreported agent session is a distinct prerequisite: startup succeeds, nothing is submitted or closed", async () => {
    const claude = { ...agent, agent: "claude", agent_session: undefined };
    const request = { ...launchRequest, harness: { kind: "claude", model: "opus" } };
    const bare = { ...retireWorkspace, panes: [{ ...owned[0], agent_session: null }] };
    const steps = [envelope("workspace_created", { workspace, tab, root_pane: pane }), envelope("agent_started", { agent: claude, argv: [] }), envelope("agent_info", { agent: claude })];
    await plan(steps);
    const startedOnly = await invoke({ route: local, request });
    assert.equal(startedOnly.isError, false, JSON.stringify(startedOnly.structuredContent));
    assert.partialDeepStrictEqual(startedOnly.structuredContent, { ok: true, data: { agent: { agent: "claude" }, expected: null, retire: bare, task: "not_requested" } });
    await plan(steps);
    const withTask = await invoke({ route: local, request: { ...request, task: { text: "Do the task." } } });
    assert.equal(withTask.isError, true);
    assert.partialDeepStrictEqual(withTask.structuredContent, { ok: false, operation: "agent_launch", error: {
      code: "agent_session_unreported", stage: "verify", recovery: { retire: bare, agent_name: "worker" },
      mutations: { layout: "applied", agent_start: "applied", submission: "not_attempted", close: "not_attempted" },
    } });
    assert.equal((await calls()).length, 3);
    await plan([envelope("agent_info", { agent: claude })]);
    const prompt = await invoke({ route: local, request: promptRequest });
    assert.partialDeepStrictEqual(prompt.structuredContent, { ok: false, error: { code: "agent_session_unreported", stage: "preflight", mutations: { submission: "not_attempted" }, recovery: null } });
    assert.equal((await calls()).length, 1);
    await plan([envelope("pane_list", { panes: [{ ...pane, agent: "claude", agent_session: undefined }] })]);
    const retire = await invoke({ route: local, request: { operation: "task_retire", ...bare } });
    assert.partialDeepStrictEqual(retire.structuredContent, { ok: false, error: { code: "agent_session_unreported", stage: "preflight", mutations: { close: "not_attempted" } } });
    assert.equal((await calls()).length, 1);
  });

  await t.test("a partial launch reports each sent mutation and recovery identity, without retry, rollback or submission", async () => {
    const created = envelope("workspace_created", { workspace, tab, root_pane: pane });
    const started = envelope("agent_started", { agent, argv: [] });
    const failure = (code: string): Step => ({ stdout: "", code: 1, stderr: JSON.stringify({ id: "fixture", error: { code, message: "Exact server failure" } }) });
    const request = { ...launchRequest, task: { text: "Do the task." } };
    const bare = { ...retireWorkspace, panes: [{ ...owned[0], agent_session: null }] };
    const verified = { layout: "applied", agent_start: "applied", submission: "not_attempted", close: "not_attempted" };
    const cases: { steps: Step[]; error: object; location?: object; cancelOnStart?: true }[] = [
      { steps: [failure("workspace_not_found")], error: { code: "workspace_not_found", stage: "layout", recovery: null, mutations: { layout: "uncertain", agent_start: "not_attempted", submission: "not_attempted" } } },
      { steps: [{ stdout: "created, but not JSON" }], error: { code: "invalid_response", stage: "layout", recovery: null, mutations: { layout: "uncertain", agent_start: "not_attempted" } } },
      { steps: [envelope("tab_created", { tab, root_pane: { ...pane, pane_id: "wOther:p1", workspace_id: "wOther" } })], location: { kind: "tab", workspace_id: agent.workspace_id, label: "Review" },
        error: { code: "target_mismatch", stage: "layout", mutations: { layout: "applied", agent_start: "not_attempted" },
          recovery: { retire: { target: { kind: "tab", workspace_id: "wOther", tab_id: agent.tab_id }, panes: [{ pane_id: "wOther:p1", terminal_id: agent.terminal_id, agent_session: null }] } } } },
      { steps: [created, failure("agent_not_ready")], error: { code: "agent_not_ready", stage: "startup", recovery: { retire: bare, agent_name: "worker" }, mutations: { layout: "applied", agent_start: "uncertain", submission: "not_attempted" } } },
      { steps: [created, { stdout: "", delay_ms: 10000 }], cancelOnStart: true, error: { code: "cancelled", stage: "startup", recovery: { retire: bare }, mutations: { layout: "applied", agent_start: "uncertain", submission: "not_attempted" } } },
      ...[
        { ...agent, agent: "claude" }, { ...agent, terminal_id: "replaced" }, { ...agent, tab_id: "wM:tOther" }, { ...agent, workspace_id: "wOther" },
        { ...agent, agent_session: { ...agent.agent_session, agent: "claude" } },
      ].map((current) => ({ steps: [created, started, envelope("agent_info", { agent: current })], error: { code: "identity_changed", stage: "verify", recovery: { retire: bare }, mutations: verified } })),
      ...[{ ...agent, cwd: "/other" }, { ...agent, cwd: `${agent.cwd}-2` }, { ...agent, cwd: null }, { ...agent, cwd: undefined }].map((current) => (
        { steps: [created, started, envelope("agent_info", { agent: current })], error: { code: "cwd_mismatch", stage: "verify", recovery: { retire: retireWorkspace }, mutations: verified } }
      )),
      ...[{ ...agent, agent_status: "blocked" }, { ...agent, agent_status: "unknown" }, { ...agent, interactive_ready: false }].map((current) => (
        { steps: [created, started, envelope("agent_info", { agent: current })], error: { code: "agent_not_ready", stage: "verify", recovery: { retire: retireWorkspace }, mutations: verified } }
      )),
      { steps: [created, started, envelope("agent_info", { agent }), failure("agent_prompt_stalled")], error: { code: "agent_prompt_stalled", stage: "request", recovery: { retire: retireWorkspace }, mutations: { ...verified, submission: "uncertain" } } },
      { steps: [created, started, envelope("agent_info", { agent }), envelope("agent_prompted", { agent: { ...agent, agent_session: { ...agent.agent_session, value: "/another-session" } } })],
        error: { code: "identity_or_state_changed", stage: "request", recovery: { retire: retireWorkspace }, mutations: { ...verified, submission: "applied" } } },
    ];
    for (const item of cases) {
      await plan(item.steps);
      const abort = new AbortController();
      const watcher = !item.cancelOnStart ? undefined : watch(logPath, () => {
        if (readFileSync(logPath, "utf8").includes('"start"')) abort.abort();
      });
      try {
        const result = await invoke({ route: local, request: { ...request, location: item.location ?? request.location } }, abort.signal);
        assert.equal(result.isError, true);
        assert.partialDeepStrictEqual(result.structuredContent, { ok: false, operation: "agent_launch", error: item.error });
      } finally { watcher?.close(); }
      const recorded = (await calls()).map((call) => call.args);
      assert.equal(recorded.length, item.steps.length);
      assert.equal(recorded.some((args) => args.includes("close")), false);
    }
    // Once identity is verified, the recovery handle names the observed conversation, so it retires as returned.
    await plan([created, started, envelope("agent_info", { agent: { ...agent, cwd: "/other" } })]);
    const mismatch = await invoke({ route: local, request });
    const failed = mismatch.structuredContent;
    assert.ok(Check(Type.Object({ error: Type.Object({ code: Type.Literal("cwd_mismatch"), recovery: Type.Object({ retire: Type.Object({ target: Type.Unknown(), panes: Type.Unknown() }) }) }) }), failed));
    const { target, panes } = failed.error.recovery.retire;
    await plan([envelope("pane_list", { panes: [{ ...pane, cwd: "/other" }] }), envelope("ok", {})]);
    const retired = await invoke({ route: local, request: { operation: "task_retire", target, panes } });
    assert.equal(retired.isError, false, JSON.stringify(retired.structuredContent));
    assert.deepEqual((await calls()).map((call) => call.args), [["pane", "list", "--workspace", agent.workspace_id], ["workspace", "close", agent.workspace_id]]);
  });

  await t.test("retire closes only a scope whose live terminals are exactly the declared, settled, same-conversation, non-coordinating panes", async () => {
    const other = { ...pane, pane_id: "wM:pZ", terminal_id: "term_other" };
    const shell = { ...pane, agent: null, agent_session: null };
    const bare = [{ ...owned[0], agent_session: null }];
    const coordinator = process.env.HERDR_PANE_ID;
    for (const item of [
      { panes: [pane, other], code: "ownership_mismatch" },
      { panes: [{ ...pane, terminal_id: "replaced" }], code: "ownership_mismatch" },
      { panes: [], code: "ownership_mismatch" },
      { panes: [pane], declared: [...owned, { pane_id: other.pane_id, terminal_id: other.terminal_id, agent_session: null }], code: "ownership_mismatch" },
      ...["working", "blocked", "unknown"].map((agent_status) => ({ panes: [{ ...pane, agent_status }], code: "agent_not_settled" })),
      { panes: [{ ...shell, agent_status: "unknown" }], declared: bare, code: "agent_not_settled" },
      { panes: [{ ...pane, agent_session: undefined }], code: "agent_session_unreported" },
      { panes: [{ ...pane, agent_session: { ...agent.agent_session, value: "/another-session" } }], code: "conversation_changed" },
      { panes: [{ ...pane, agent: "claude", agent_session: { ...agent.agent_session, agent: "claude" } }], code: "conversation_changed" },
      { panes: [pane], declared: bare, code: "conversation_changed" },
      { panes: [shell], code: "conversation_changed" },
      { panes: [{ ...pane, workspace_id: "wOther" }], code: "target_mismatch" },
      { panes: [{ ...pane, pane_id: coordinator }], declared: [{ ...owned[0], pane_id: coordinator }], code: "self_retire" },
    ]) {
      for (const handle of [retireWorkspace, retireTab]) {
        await plan([envelope("pane_list", { panes: item.panes })]);
        const result = await invoke({ route: local, request: { operation: "task_retire", ...handle, panes: item.declared ?? owned } });
        assert.equal(result.isError, true);
        assert.partialDeepStrictEqual(result.structuredContent, { ok: false, operation: "task_retire", error: { code: item.code, stage: "preflight", mutations: { close: "not_attempted" } } });
        assert.deepEqual((await calls()).map((call) => call.args), [["pane", "list", "--workspace", agent.workspace_id]]);
      }
    }
    // A terminal whose agent never started or has exited is closable only when declared as bare.
    await plan([envelope("pane_list", { panes: [shell] }), envelope("ok", {})]);
    const closedShell = await invoke({ route: local, request: { operation: "task_retire", ...retireWorkspace, panes: bare } });
    assert.equal(closedShell.isError, false, JSON.stringify(closedShell.structuredContent));
    for (const item of [
      { step: { stdout: "", code: 1, stderr: JSON.stringify({ id: "fixture", error: { code: "workspace_group_close_required", message: "Group" } }) }, code: "workspace_group_close_required" },
      { step: envelope("workspace_closed", { workspace_id: agent.workspace_id }), code: "invalid_response" },
      { step: { stdout: "", stderr: "connection lost", code: 255 }, code: "transport_error" },
    ]) {
      await plan([envelope("pane_list", { panes: [pane] }), item.step]);
      const failed = await invoke({ route: local, request: { operation: "task_retire", ...retireWorkspace } });
      assert.partialDeepStrictEqual(failed.structuredContent, { ok: false, error: { code: item.code, stage: "request", mutations: { close: "uncertain", layout: "not_attempted", submission: "not_attempted" } } });
      assert.equal((await calls()).length, 2);
    }
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
