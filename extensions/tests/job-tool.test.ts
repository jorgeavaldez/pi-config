import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { wrapToolDefinition } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/tool-definition-wrapper.js";
import { Type } from "typebox";
import { Check } from "typebox/value";

const local = { kind: "local" };
const remote = { kind: "ssh", host: "test-user@exact-host" };
const windows = process.platform === "win32";
const needsTmux = windows ? "background jobs are POSIX only; these run the real launcher under tmux" : false;
const callsSchema = Type.Array(Type.Object({ args: Type.Array(Type.String()), stdin: Type.String() }));
const jobSchema = Type.Object({
  id: Type.String({ pattern: "^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$" }), session: Type.String(), log_dir: Type.String(),
  state: Type.String(), exit_status: Type.Union([Type.Integer(), Type.Null()]), ready: Type.String(),
});
const resultSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), data: Type.Object({
    job: jobSchema, waited: Type.Optional(Type.String()), reached: Type.Optional(Type.Boolean()),
    text: Type.Optional(Type.String()), stopped: Type.Optional(Type.Boolean()),
  }) }),
  Type.Object({ ok: Type.Literal(false), error: Type.Object({
    code: Type.String(), message: Type.String(),
    recovery: Type.Union([Type.Object({ job: Type.String(), session: Type.String(), log_dir: Type.String() }), Type.Null()]),
  }) }),
]);
interface Step { stdout?: string; stderr?: string; code?: number; delay_ms?: number }

// The ssh fixture records argv/stdin. A planned step answers with a canned host response; without one it
// runs the command as sshd would (POSIX only), so the same tool code drives the real launcher.
test("deferred background-job tool through native Pi", { timeout: 180000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-job-tool-")));
  const planPath = join(root, "plan.json");
  const countPath = join(root, "count");
  const logPath = join(root, "calls.jsonl");
  const environment = {
    PATH: `${root}${delimiter}${process.env.PATH}`, JOB_TEST_PLAN: planPath, JOB_TEST_COUNT: countPath, JOB_TEST_LOG: logPath,
    // Jobs land in a private home and a private tmux server, never the user's.
    HOME: root, TMUX_TMPDIR: root,
    // Windows: the tool takes ssh from %windir%\System32\OpenSSH, never from PATH.
    ...(windows ? { windir: root } : {}),
  };
  for (const [key, value] of Object.entries(environment)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  // Every direct tmux call names the private server's socket. Relying on TMUX_TMPDIR is not enough: it is
  // already restored when teardown runs, and a bare kill-server there ends the user's own tmux server.
  const tmux = (...args: string[]) => execFileSync("tmux", ["-S", join(root, `tmux-${process.getuid?.()}`, "default"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  t.after(async () => {
    if (!windows) try { tmux("kill-server"); } catch { /* no job was started */ }
    await rm(root, { recursive: true, force: true });
  });
  const source = `
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), stdin = readFileSync(0,'utf8');
appendFileSync(process.env.JOB_TEST_LOG, JSON.stringify({args, stdin})+'\\n');
const index = Number(readFileSync(process.env.JOB_TEST_COUNT, 'utf8'));
writeFileSync(process.env.JOB_TEST_COUNT, String(index+1));
const step = JSON.parse(readFileSync(process.env.JOB_TEST_PLAN,'utf8'))[index];
if (step) {
  process.stdout.write(step.stdout ?? '', () => {
    process.stderr.write(step.stderr ?? '', () => setTimeout(() => process.exit(step.code ?? 0), step.delay_ms ?? 0));
  });
} else {
  const result = spawnSync('zsh', ['-f', '-c', args.at(-1)], { input: stdin, encoding: 'utf8' });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 255);
}
`;
  if (windows) {
    // Windows resolves only real executables, so the fixture is built as a Node single executable.
    const main = join(root, "ssh.cjs");
    const config = join(root, "ssh.sea.json");
    await mkdir(join(root, "System32", "OpenSSH"), { recursive: true });
    await writeFile(main, source);
    await writeFile(config, JSON.stringify({ main, output: join(root, "System32", "OpenSSH", "ssh.exe"), disableExperimentalSEAWarning: true }));
    execFileSync(process.execPath, [`--build-sea=${config}`], { stdio: "ignore" });
  } else {
    await writeFile(join(root, "ssh"), `#!${process.execPath}\n${source}`);
    await chmod(join(root, "ssh"), 0o755);
    // A mise that records the directory it ran each job from, then runs it.
    await writeFile(join(root, "mise"), `#!/bin/sh\n[ "$1 $2" = "exec --" ] || exit 90\nshift 2\npwd >>"$HOME/mise.log"\nexec "$@"\n`);
    await chmod(join(root, "mise"), 0o755);
  }
  // The private server numbers windows and panes from 1, so nothing here can pass by assuming :0.0.
  await writeFile(join(root, ".tmux.conf"), "set -g base-index 1\nsetw -g pane-base-index 1\n");
  const loaded = await discoverAndLoadExtensions([fileURLToPath(new URL("../job-tool.ts", import.meta.url))], root, root);
  assert.deepEqual(loaded.errors, []);
  const models = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), new ModelRegistry(models));
  loaded.runtime.getThinkingLevel = () => "off";
  const registered = runner.getToolDefinition("job");
  assert.ok(registered);
  const tool = registered;
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
  async function invoke(route: object, request: object, signal?: AbortSignal) {
    const args = { route, request };
    assert.ok(Check(tool.parameters, args), "test input must match the public schema");
    const result = await native.execute("job-test", args, signal);
    const value: unknown = result.structuredContent;
    assert.ok(tool.outputSchema && Check(tool.outputSchema, value), "every success/error must match outputSchema");
    assert.ok(Check(resultSchema, value));
    assert.equal(result.isError, !value.ok);
    return { value, text: result.content.map((part) => part.type === "text" ? part.text : "").join("") };
  }
  async function succeed(route: object, request: object) {
    const { value, text } = await invoke(route, request);
    assert.ok(value.ok, JSON.stringify(value));
    return { ...value.data, content: text };
  }
  async function fail(route: object, request: object, signal?: AbortSignal) {
    const { value } = await invoke(route, request, signal);
    assert.ok(!value.ok, JSON.stringify(value));
    return value.error;
  }
  function status(fields: object = {}): Step {
    return { stdout: `${JSON.stringify({ log_dir: "/home/u/.cache/pi/tmux-background/pi-job-x", wait_mode: "log", session: "alive", exit_status: null, ready_status: null, ...fields })}\n` };
  }
  // The launch script's own status line carries the launcher's exit.
  const launched = (fields: object = {}) => status({ launcher_exit: 0, ...fields });
  const logStart = { operation: "start", command: ["npm", "run", "dev"], cwd: "/srv/app", ready: { kind: "log", pattern: "ready in" } };
  const exitStart = { ...logStart, ready: { kind: "exit" } };
  const knownJob = "20261010-120000-0123abcd";
  const jobsRoot = join(root, ".cache", "pi", "tmux-background");
  // The private server exits with its last session.
  const sessions = () => { try { return tmux("list-sessions", "-F", "#{session_name}").trim().split("\n"); } catch { return []; } };

  await t.test("one deferred tool whose schema admits workflow intent only", () => {
    assert.equal(runner.getAllRegisteredTools().length, 1);
    assert.equal(tool.exposure, "deferred");
    assert.equal(tool.namespace?.name, "job");
    assert.ok(tool.namespace?.instructions);
    for (const request of [
      { ...logStart, cwd: "srv/app" }, { ...logStart, cwd: "~/app" }, { ...logStart, cwd: "C:\\app" },
      { ...logStart, command: [] }, { ...logStart, command: "npm run dev" }, { ...logStart, command: ["a\0b"] },
      { ...logStart, session: "mine" }, { ...logStart, replace: true }, { ...logStart, log_root: "/tmp" },
      { ...logStart, ready: { kind: "log" } }, { ...logStart, ready: { kind: "log", pattern: "" } }, { ...logStart, ready: { kind: "log", pattern: "a\nb" } },
      { ...logStart, ready: { kind: "log", pattern: "ok", timeout_ms: 600001 } },
      { ...logStart, ready: { kind: "http", url: "file:///etc/passwd" } },
      { ...logStart, ready: { kind: "port", port: 0 } }, { ...logStart, ready: { kind: "port", port: 80, host: "example.com" } },
      { ...logStart, ready: { kind: "none", timeout_ms: 1000 } },
      { operation: "wait", job: knownJob }, { operation: "wait", job: knownJob, until: "exit", timeout_ms: 600001 },
      { operation: "read", job: knownJob, lines: 501 }, { operation: "read", job: "pi-job-other" }, { operation: "read", job: "../../x" },
      { operation: "stop", job: knownJob, force: true }, { operation: "stop", session: "dev-server" },
      { operation: "tmux", args: ["kill-server"] },
    ]) assert.equal(Check(tool.parameters, { route: remote, request }), false, JSON.stringify(request));
    assert.equal(Check(tool.parameters, { route: { kind: "ssh", host: "-oProxyCommand=oops" }, request: logStart }), false);
    assert.equal(Check(tool.parameters, { route: { kind: "ssh" }, request: logStart }), false);
    for (const request of [
      logStart, exitStart, { operation: "start", command: ["true"], cwd: "/srv/app" }, { ...logStart, ready: { kind: "none" } },
      { ...logStart, ready: { kind: "port", port: 3000, timeout_ms: 90000 } },
      { ...logStart, ready: { kind: "http", url: "http://127.0.0.1:3000/health", expect: "ok" } },
      { ...logStart, ready: { kind: "log", pattern: "--listening" } }, { ...logStart, ready: { kind: "http", url: "http://h/", expect: "-v" } },
      { operation: "wait", job: knownJob, until: "exit" }, { operation: "read", job: knownJob }, { operation: "stop", job: knownJob },
    ]) assert.equal(Check(tool.parameters, { route: local, request }), true, JSON.stringify(request));
  });

  await t.test("a Windows local route fails clearly without starting anything", { skip: windows ? false : "Windows only" }, async () => {
    await plan([]);
    for (const request of [logStart, { operation: "stop", job: knownJob }]) {
      const error = await fail(local, request);
      assert.equal(error.code, "local_route_unavailable");
      assert.match(error.message, /SSH route/);
      assert.equal(error.recovery, null);
    }
    assert.deepEqual(await calls(), []);
  });

  await t.test("start sends one self-contained launch over stdin, then waits for the signal on the host", async () => {
    const hostile = `quotes ' "; $(touch ${join(root, "injected")})\n\`id\` $HOME`;
    await plan([launched(), status({ ready_status: 0 })]);
    const data = await succeed(remote, { ...logStart, command: ["bash", "-c", hostile], ready: { kind: "log", pattern: "ready in", timeout_ms: 5000 } });
    assert.equal(data.waited, "reached");
    assert.partialDeepStrictEqual(data.job, { session: `pi-job-${data.job.id}`, state: "running", exit_status: null, ready: "ready" });
    const [launch, wait, ...extra] = await calls();
    assert.ok(launch && wait);
    assert.deepEqual(extra, []);
    // Command data never reaches the ssh command line.
    for (const call of [launch, wait]) assert.deepEqual(call.args, ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", remote.host, "zsh -lic 'exec bash -s'"]);
    for (const name of ["tmux-background.sh", "pipe-pane-watch.sh", "wait-for-http.sh", "wait-for-port.sh"]) {
      assert.ok(launch.stdin.includes(await readFile(new URL(`../../skills/tmux-background/scripts/${name}`, import.meta.url), "utf8")), name);
    }
    const invocation = launch.stdin.slice(launch.stdin.indexOf('\nbash "$dir/scripts/tmux-background.sh"'));
    // The launcher's stdin is never the script bash -s is still reading.
    assert.ok(invocation.startsWith(`\nbash "$dir/scripts/tmux-background.sh" --log-dir "$dir" '--session' 'pi-job-${data.job.id}' '--detach' '--cwd' '/srv/app' '--wait' 'log' '--timeout' '5' '--pattern' 'ready in' '--' 'bash' '-c' '${hostile.replaceAll("'", "'\\''")}' </dev/null >`));
    assert.equal(invocation.includes("--replace"), false);
    assert.ok(wait.stdin.includes(`session=pi-job-${data.job.id}\n`));
    assert.ok(wait.stdin.includes('[ -s "$dir/ready.status" ] && break'));
  });

  await t.test("start waits for exit by default; only the recorded exit status means completion", async () => {
    await plan([launched({ wait_mode: "exit" }), status({ wait_mode: "exit", session: "absent", exit_status: 7 })]);
    const failed = await succeed(remote, { operation: "start", command: ["make"], cwd: "/srv/app" });
    assert.equal(failed.waited, "reached");
    assert.partialDeepStrictEqual(failed.job, { state: "exited", exit_status: 7, ready: "not_applicable" });
    const [launch, wait] = await calls();
    assert.ok(launch?.stdin.includes("'--wait' 'exit' '--timeout' '60' '--' 'make'"));
    assert.ok(wait && !wait.stdin.includes("ready.status\" ] && break"));
    await plan([launched({ wait_mode: "exit" }), status({ wait_mode: "exit" })]);
    const running = await succeed(remote, exitStart);
    assert.equal(running.waited, "not_reached");
    assert.partialDeepStrictEqual(running.job, { state: "running", exit_status: null });
    await plan([launched({ wait_mode: "none" })]);
    const unwaited = await succeed(remote, { ...logStart, ready: { kind: "none" } });
    assert.equal(unwaited.waited, "not_requested");
    assert.partialDeepStrictEqual(unwaited.job, { state: "running", exit_status: null, ready: "not_applicable" });
    assert.equal((await calls()).length, 1);
    await plan([launched(), status({ ready_status: 1 })]);
    const unready = await succeed(remote, logStart);
    assert.equal(unready.waited, "not_reached");
    assert.partialDeepStrictEqual(unready.job, { state: "running", ready: "failed" });
  });

  await t.test("a start whose outcome is unknown returns the job identity and is never retried", async () => {
    for (const [step, code] of [
      [{ stderr: "Connection reset", code: 255 }, "transport_error"], [{ stdout: "motd noise\n" }, "invalid_response"],
      [{ stdout: '{"log_dir":"/x","wait_mode":"log","session":"yes"}\n' }, "invalid_response"],
      // The start status must carry the launcher's exit.
      [status(), "invalid_response"],
      [{ ...launched({ launcher_exit: 5 }), stderr: "tmux-background.sh: could not attach output logging or release the command; session pi-job-x was killed\n" }, "launch_incomplete"],
    ] as const) {
      await plan([step]);
      const error = await fail(remote, logStart);
      assert.equal(error.code, code);
      assert.ok(error.recovery);
      assert.match(error.recovery.job, /^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/);
      assert.deepEqual(error.recovery, { job: error.recovery.job, session: `pi-job-${error.recovery.job}`, log_dir: `~/.cache/pi/tmux-background/pi-job-${error.recovery.job}` });
      const recorded = await calls();
      assert.equal(recorded.length, 1);
      assert.ok(recorded[0]?.stdin.includes(`session=pi-job-${error.recovery.job}\n`));
      if (code === "launch_incomplete") assert.match(error.message, /launcher exit 5.*may remain.*could not attach output logging/);
    }
    const abort = new AbortController();
    await plan([{ delay_ms: 10000 }]);
    const watcher = watch(logPath, () => abort.abort());
    try {
      const cancelled = await fail(remote, logStart, abort.signal);
      assert.equal(cancelled.code, "cancelled");
      assert.ok(cancelled.recovery);
      assert.equal((await calls()).length, 1);
    } finally { watcher.close(); }
    // The job exists once the launch is confirmed, whatever happens to the wait that follows.
    await plan([launched(), { stderr: "Connection reset", code: 255 }]);
    const lostWait = await fail(remote, logStart);
    assert.equal(lostWait.code, "transport_error");
    assert.ok(lostWait.recovery);
    assert.equal((await calls()).length, 2);
    // A rejected start created no session, so there is nothing to recover.
    const stderr = "tmux-background.sh: --cwd does not exist or is not a directory: /srv/app\n";
    await plan([{ stdout: '{"rejected":true}\n', stderr }]);
    const rejected = await fail(remote, logStart);
    assert.equal(rejected.code, "launch_rejected");
    assert.ok(rejected.message.includes(stderr.trim()));
    assert.equal(rejected.recovery, null);
    const launchScript = (await calls())[0]?.stdin ?? "";
    assert.ok(launchScript.includes(String.raw`mkdir -p "$root" && mkdir "$dir" "$dir/scripts" || { printf '{"rejected":true}\n'; exit 0; }`));
    assert.ok(launchScript.includes(String.raw`case "$rc" in 2|3|4|127) printf '{"rejected":true}\n'; exit 0 ;; esac`));
    // Only start may report a rejection.
    await plan([{ stdout: '{"rejected":true}\n' }]);
    assert.equal((await fail(remote, { operation: "read", job: knownJob })).code, "invalid_response");
    const aborted = new AbortController();
    aborted.abort();
    await plan([]);
    const unsent = await fail(remote, logStart, aborted.signal);
    assert.equal(unsent.code, "cancelled");
    assert.deepEqual(await calls(), []);
  });

  await t.test("wait, read and stop verify the job belongs to the tool, bound their work and report from status files", async () => {
    for (const request of [{ operation: "wait", job: knownJob, until: "exit" }, { operation: "read", job: knownJob }, { operation: "stop", job: knownJob }]) {
      await plan([{ stdout: '{"unknown_job":true}\n' }]);
      const error = await fail(remote, request);
      assert.equal(error.code, "unknown_job");
      assert.equal(error.recovery, null);
      const script = (await calls())[0]?.stdin ?? "";
      const ownership = script.indexOf(String.raw`[ "$(field session)" = "$session" ] || { printf '{"unknown_job":true}\n'; exit 0; }`);
      assert.ok(ownership > script.indexOf(`session=pi-job-${knownJob}\n`));
      for (const action of ["kill-session", "tail -n", "while "]) assert.ok(!script.includes(action) || script.indexOf(action) > ownership, action);
    }
    await plan([status({ session: "absent", stopped: true })]);
    const stopped = await succeed(remote, { operation: "stop", job: knownJob });
    assert.equal(stopped.stopped, true);
    assert.partialDeepStrictEqual(stopped.job, { id: knownJob, state: "gone", exit_status: null, ready: "failed" });
    // The kill names the recorded server and the exact session name.
    const stop = (await calls())[0]?.stdin ?? "";
    assert.ok(stop.includes(`tmux -S "$socket" kill-session -t "=$session"`));
    assert.equal(stop.split("tmux ").length, stop.split('tmux -S "$socket" ').length);
    assert.equal(stop.split("kill-session").length, 2);
    assert.equal(/\brm\b|--replace|kill-server/.test(stop), false);
    await plan([status({ session: "absent", stopped: false, exit_status: 0 })]);
    const ended = await succeed(remote, { operation: "stop", job: knownJob });
    assert.equal(ended.stopped, false);
    assert.equal(ended.job.state, "exited");
    // A stop status must say whether the kill happened.
    await plan([status({ session: "absent" })]);
    assert.equal((await fail(remote, { operation: "stop", job: knownJob })).code, "invalid_response");
    for (const [fields, state, ready] of [
      [{}, "running", "pending"], [{ session: "unknown" }, "unknown", "pending"], [{ session: "absent" }, "gone", "failed"],
      [{ session: "absent", exit_status: 0 }, "exited", "failed"], [{ session: "unknown", exit_status: 0, ready_status: 0 }, "exited", "ready"],
      [{ wait_mode: "none", session: "absent" }, "gone", "not_applicable"],
    ] as const) {
      await plan([status(fields)]);
      assert.partialDeepStrictEqual((await succeed(remote, { operation: "read", job: knownJob })).job, { state, ready });
    }
    await plan([{ stdout: `${status({ exit_status: 0, ready_status: 0 }).stdout}\u001b[32mready in 120ms\u001b[0m\r\nline two\n` }]);
    const read = await succeed(remote, { operation: "read", job: knownJob, lines: 500 });
    assert.equal(read.text, "ready in 120ms\nline two\n");
    assert.partialDeepStrictEqual(read.job, { state: "exited", exit_status: 0, ready: "ready" });
    assert.ok(read.content.endsWith("\nready in 120ms\nline two\n"));
    assert.ok((await calls())[0]?.stdin.includes('tail -n 500 "$dir/pane.log" | tail -c 30000'));
    await plan([status()]);
    assert.equal((await succeed(remote, { operation: "wait", job: knownJob, until: "ready", timeout_ms: 1500 })).reached, false);
    assert.ok((await calls())[0]?.stdin.includes("end=$((SECONDS + 2))"));
    const abort = new AbortController();
    await plan([{ delay_ms: 10000 }]);
    const watcher = watch(logPath, () => abort.abort());
    try {
      assert.equal((await fail(remote, { operation: "wait", job: knownJob, until: "exit" }, abort.signal)).code, "cancelled");
    } finally { watcher.close(); }
  });

  await t.test("log readiness is watched from before the command starts; read and stop act on the exact owned session", { skip: needsTmux }, async () => {
    await plan([]);
    // Printed at once: only a watcher attached before the command runs can see it.
    const started = await succeed(local, { operation: "start", command: ["bash", "-c", "echo --READY-NOW--; exec sleep 300"], cwd: root, ready: { kind: "log", pattern: "--READY-NOW-+$", timeout_ms: 20000 } });
    assert.equal(tmux("list-panes", "-s", "-t", `=${started.job.session}`, "-F", "#{window_index}.#{pane_index}").trim(), "1.1");
    assert.equal(started.waited, "reached");
    assert.partialDeepStrictEqual(started.job, { state: "running", exit_status: null, ready: "ready", log_dir: join(jobsRoot, started.job.session) });
    const read = await succeed(local, { operation: "read", job: started.job.id, lines: 20 });
    assert.match(read.text ?? "", /^--READY-NOW--$/m);
    // A session that merely looks like a job, and an unrelated one sharing the name prefix, are not the tool's.
    const foreign = "pi-job-20261010-120000-0123abcd";
    tmux("new-session", "-d", "-s", foreign, "sleep 300");
    tmux("new-session", "-d", "-s", `${started.job.session}-other`, "sleep 300");
    assert.equal((await fail(local, { operation: "stop", job: knownJob })).code, "unknown_job");
    const stopped = await succeed(local, { operation: "stop", job: started.job.id });
    assert.equal(stopped.stopped, true);
    assert.partialDeepStrictEqual(stopped.job, { state: "gone", exit_status: null });
    assert.deepEqual(sessions().sort(), [foreign, `${started.job.session}-other`].sort());
    tmux("kill-session", "-t", `=${foreign}`);
    tmux("kill-session", "-t", `=${started.job.session}-other`);
    assert.match(await readFile(join(started.job.log_dir, "pane.log"), "utf8"), /READY-NOW/);
    const again = await succeed(local, { operation: "stop", job: started.job.id });
    assert.equal(again.stopped, false);
    assert.match((await succeed(local, { operation: "read", job: started.job.id })).text ?? "", /READY-NOW/);
  });

  await t.test("by default start waits for exit; the session ends with the command and keeps its output and exit status", { skip: needsTmux }, async () => {
    await plan([]);
    await writeFile(join(root, "mise.log"), "");
    const marker = join(root, "argv literal $(touch injected) 'q'");
    const done = await succeed(local, { operation: "start", command: ["bash", "-c", 'printf "%s" "$1" > "$0"; echo done; exit 7', marker, "$(id) `id` 'x'\n\"y\""], cwd: root });
    assert.equal(done.waited, "reached");
    assert.partialDeepStrictEqual(done.job, { state: "exited", exit_status: 7, ready: "not_applicable" });
    assert.equal(await readFile(marker, "utf8"), "$(id) `id` 'x'\n\"y\"");
    assert.equal(existsSync(join(root, "injected")), false);
    // mise on the launch PATH runs the command from its cwd.
    assert.equal(await readFile(join(root, "mise.log"), "utf8"), `${root}\n`);
    for (let attempt = 0; attempt < 50 && sessions().includes(done.job.session); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sessions().includes(done.job.session), false);
    const read = await succeed(local, { operation: "read", job: done.job.id });
    assert.partialDeepStrictEqual(read.job, { state: "exited", exit_status: 7 });
    assert.match(read.text ?? "", /^done$[\s\S]*Command exited with status 7$/m);
    assert.equal((await succeed(local, { operation: "wait", job: done.job.id, until: "ready", timeout_ms: 5000 })).reached, false);
  });

  await t.test("without mise on PATH the command runs directly", { skip: needsTmux }, async () => {
    await plan([]);
    await writeFile(join(root, "mise.log"), "");
    // Only tmux and the system directories: no mise anywhere.
    const bin = join(root, "no-mise-bin");
    await mkdir(bin);
    await symlink(execFileSync("sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim(), join(bin, "tmux"));
    const path = process.env.PATH;
    process.env.PATH = [bin, "/usr/bin", "/bin"].join(delimiter);
    try {
      const done = await succeed(local, { operation: "start", command: ["sh", "-c", "command -v mise || echo no-mise"], cwd: root });
      assert.partialDeepStrictEqual(done.job, { state: "exited", exit_status: 0 });
      assert.match((await succeed(local, { operation: "read", job: done.job.id })).text ?? "", /^no-mise$/m);
    } finally { process.env.PATH = path; }
    assert.equal(await readFile(join(root, "mise.log"), "utf8"), "");
  });

  await t.test("a start that cannot claim its audit directory or whose cwd is missing creates nothing", { skip: needsTmux }, async () => {
    await plan([]);
    const before = sessions();
    const missing = await fail(local, { ...exitStart, cwd: join(root, "missing") });
    assert.equal(missing.code, "launch_rejected");
    assert.match(missing.message, /--cwd does not exist/);
    assert.equal(missing.recovery, null);
    await mkdir(jobsRoot, { recursive: true });
    await chmod(jobsRoot, 0o555);
    try {
      const unwritable = await fail(local, exitStart);
      assert.equal(unwritable.code, "launch_rejected");
      assert.match(unwritable.message, /mkdir/);
      assert.equal(unwritable.recovery, null);
    } finally { await chmod(jobsRoot, 0o755); }
    assert.deepEqual(sessions(), before);
  });

  await t.test("HTTP readiness is watched after the launcher has returned, and its timeout is a failed signal, not an error", { skip: needsTmux }, async () => {
    await plan([]);
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")));
      });
    });
    const server = `setTimeout(() => require("node:http").createServer((_, response) => response.end("-healthy-")).listen(${port}, "127.0.0.1"), 1500)`;
    const started = await succeed(local, { operation: "start", command: [process.execPath, "-e", server], cwd: root, ready: { kind: "http", url: `http://127.0.0.1:${port}/`, expect: "-healthy-$", timeout_ms: 20000 } });
    assert.equal(started.waited, "reached");
    assert.partialDeepStrictEqual(started.job, { state: "running", exit_status: null, ready: "ready" });
    assert.equal((await succeed(local, { operation: "stop", job: started.job.id })).stopped, true);
    const never = await succeed(local, { operation: "start", command: ["sleep", "300"], cwd: root, ready: { kind: "port", port, timeout_ms: 1000 } });
    assert.equal(never.waited, "not_reached");
    assert.partialDeepStrictEqual(never.job, { state: "running", exit_status: null, ready: "failed" });
    assert.equal((await succeed(local, { operation: "stop", job: never.job.id })).stopped, true);
  });

  await t.test("stop also ends a readiness watcher that is still polling", { skip: needsTmux }, async () => {
    await plan([]);
    // Cancel the start once its launch has returned, leaving the job and its watcher running.
    const abort = new AbortController();
    const watcher = watch(logPath, () => { void readFile(logPath, "utf8").then((raw) => { if (raw.trim().split("\n").length >= 2) abort.abort(); }); });
    const cancelled = await fail(remote, { operation: "start", command: ["sleep", "300"], cwd: root, ready: { kind: "http", url: "http://127.0.0.1:1/", timeout_ms: 600000 } }, abort.signal)
      .finally(() => watcher.close());
    assert.equal(cancelled.code, "cancelled");
    assert.ok(cancelled.recovery);
    const { job, session } = cancelled.recovery;
    const polling = () => { try { return execFileSync("pgrep", ["-f", `${join(jobsRoot, session)}/scripts/wait-for-http.sh`], { encoding: "utf8" }).trim(); } catch { return ""; } };
    assert.notEqual(polling(), "");
    assert.equal((await succeed(local, { operation: "stop", job })).stopped, true);
    for (let attempt = 0; attempt < 50 && polling(); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(polling(), "");
    assert.equal(existsSync(join(jobsRoot, session, "ready.status")), false);
  });

  await t.test("an SSH-shaped start reaches the launcher through the login shell; waits are bounded and cancelling one leaves the job running", { skip: needsTmux }, async () => {
    await plan([]);
    const started = await succeed(remote, { operation: "start", command: ["sleep", "300"], cwd: root, ready: { kind: "none" } });
    assert.equal(started.waited, "not_requested");
    assert.partialDeepStrictEqual(started.job, { state: "running", exit_status: null, ready: "not_applicable" });
    const waited = await succeed(remote, { operation: "wait", job: started.job.id, until: "exit", timeout_ms: 1000 });
    assert.equal(waited.reached, false);
    assert.equal(waited.job.state, "running");
    const abort = new AbortController();
    const cancelling = fail(local, { operation: "wait", job: started.job.id, until: "exit", timeout_ms: 60000 }, abort.signal);
    setTimeout(() => abort.abort(), 500);
    assert.equal((await cancelling).code, "cancelled");
    assert.equal((await succeed(local, { operation: "read", job: started.job.id })).job.state, "running");
    assert.equal((await succeed(remote, { operation: "stop", job: started.job.id })).stopped, true);
  });
});
