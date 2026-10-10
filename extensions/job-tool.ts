import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { execute, hostSchema, quote, ssh, type Transport } from "./shared/transport.js";

const strict = { additionalProperties: false };
const routeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("local") }, strict),
  Type.Object({ kind: Type.Literal("ssh"), host: hostSchema }, strict),
]);
// The tool mints job IDs; the tmux session and audit directory are derived from one, never supplied.
const jobId = Type.String({ pattern: "^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$" });
// An extended regex, passed to grep after "--": a leading dash is pattern data.
const regex = Type.String({ minLength: 1, maxLength: 512, pattern: "^[^\\u0000-\\u001f]+$" });
const readyDeadline = Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000, description: "How long the signal may take, in milliseconds. Default 60000." }));
const readySchema = Type.Union([
  Type.Object({ kind: Type.Literal("exit"), timeout_ms: readyDeadline }, strict),
  Type.Object({ kind: Type.Literal("http"), url: Type.String({ maxLength: 2048, pattern: "^https?://[^\\s\\u0000-\\u001f]+$" }), expect: Type.Optional(regex), timeout_ms: readyDeadline }, strict),
  Type.Object({ kind: Type.Literal("port"), port: Type.Integer({ minimum: 1, maximum: 65535 }), timeout_ms: readyDeadline }, strict),
  Type.Object({ kind: Type.Literal("log"), pattern: regex, timeout_ms: readyDeadline }, strict),
  Type.Object({ kind: Type.Literal("none") }, strict),
], { description: 'The signal start waits for: the command exiting (the default, {kind:"exit"}), an HTTP endpoint answering (optionally matching expect), 127.0.0.1:port accepting, an extended regex appearing in the output, or nothing.' });
const requestSchema = Type.Union([
  Type.Object({
    operation: Type.Literal("start"),
    command: Type.Array(Type.String({ maxLength: 16384, pattern: "^[^\\u0000]*$" }), {
      minItems: 1, maxItems: 64, description: 'Program and arguments, run without a shell. For pipes, environment assignments or several commands pass ["bash", "-c", "<script>"].',
    }),
    cwd: Type.String({ maxLength: 1024, pattern: "^/[^\\u0000-\\u001f]*$", description: "Absolute directory on the routed host." }),
    ready: Type.Optional(readySchema),
  }, strict),
  Type.Object({
    operation: Type.Literal("wait"), job: jobId, until: Type.Union([Type.Literal("ready"), Type.Literal("exit")]),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000, description: "Default 60000." })),
  }, strict),
  Type.Object({ operation: Type.Literal("read"), job: jobId, lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Trailing output lines. Default 80." })) }, strict),
  Type.Object({ operation: Type.Literal("stop"), job: jobId }, strict),
]);
const parameters = Type.Object({ route: routeSchema, request: requestSchema }, strict);
const waitMode = Type.Union([Type.Literal("exit"), Type.Literal("http"), Type.Literal("port"), Type.Literal("log"), Type.Literal("none")]);
// First stdout line of every remote script; start and stop extend the shared fields.
const statusFields = {
  log_dir: Type.String(), wait_mode: waitMode,
  // As tmux answers for the recorded server; unknown when the record names no server.
  session: Type.Union([Type.Literal("alive"), Type.Literal("absent"), Type.Literal("unknown")]),
  exit_status: Type.Union([Type.Integer(), Type.Null()]), ready_status: Type.Union([Type.Integer(), Type.Null()]),
};
const statusSchema = Type.Object(statusFields, strict);
const startStatusSchema = Type.Union([
  Type.Object({ ...statusFields, launcher_exit: Type.Integer() }, strict),
  // No session was created: the audit directory could not be claimed or the launcher refused first.
  Type.Object({ rejected: Type.Literal(true) }, strict),
]);
const stopStatusSchema = Type.Object({ ...statusFields, stopped: Type.Boolean() }, strict);
const unknownJobSchema = Type.Object({ unknown_job: Type.Literal(true) }, strict);
const jobSchema = Type.Object({
  id: jobId, session: Type.String(), log_dir: Type.String(),
  state: Type.Union([Type.Literal("running"), Type.Literal("exited"), Type.Literal("gone"), Type.Literal("unknown")]),
  exit_status: Type.Union([Type.Integer(), Type.Null()]),
  ready: Type.Union([Type.Literal("ready"), Type.Literal("failed"), Type.Literal("pending"), Type.Literal("not_applicable")]),
}, strict);
const dataSchema = Type.Union([
  Type.Object({ operation: Type.Literal("start"), job: jobSchema, waited: Type.Union([Type.Literal("not_requested"), Type.Literal("reached"), Type.Literal("not_reached")]) }, strict),
  Type.Object({ operation: Type.Literal("wait"), job: jobSchema, reached: Type.Boolean() }, strict),
  Type.Object({ operation: Type.Literal("read"), job: jobSchema, text: Type.String() }, strict),
  Type.Object({ operation: Type.Literal("stop"), job: jobSchema, stopped: Type.Boolean() }, strict),
]);
// Where a start that may have happened left its job; log_dir is relative to the routed host's home.
const recoverySchema = Type.Object({ job: jobId, session: Type.String(), log_dir: Type.String() }, strict);
const outputSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), route: routeSchema, data: dataSchema }, strict),
  Type.Object({
    ok: Type.Literal(false), route: routeSchema,
    operation: Type.Union([Type.Literal("start"), Type.Literal("wait"), Type.Literal("read"), Type.Literal("stop")]),
    error: Type.Object({
      code: Type.String(), message: Type.String(),
      transport: Type.Union([Type.Object({
        exit_code: Type.Union([Type.Integer(), Type.Null()]), signal: Type.Union([Type.String(), Type.Null()]),
        timed_out: Type.Boolean(), cancelled: Type.Boolean(), stderr: Type.String(),
      }, strict), Type.Null()]),
      recovery: Type.Union([recoverySchema, Type.Null()]),
    }, strict),
  }, strict),
]);

class JobFailure extends Error {
  constructor(readonly code: string, message: string, readonly transport: Transport | null = null) {
    super(message);
  }
}

// Shared by every script: the derived names, the job's record and the status line. exit.status and
// ready.status are written by the runner and the readiness watcher; nothing else decides completion or
// readiness. The session ends with its command, so alive means running. socket is the tmux server the
// launcher created the session in, whatever TMUX_TMPDIR says now.
const prelude = (id: string) => String.raw`set -u
session=pi-job-${id}
root=$HOME/.cache/pi/tmux-background
dir=$root/$session
field() { sed -n "s/^$1=//p" "$dir/metadata.txt" 2>/dev/null; }
alive() { [ -n "$socket" ] && tmux -S "$socket" has-session -t "=$session" 2>/dev/null; }
# The session is inspected before exit.status is read: a command that ends in between reads as exited.
report() {
  if [ -z "$socket" ]; then live=unknown; elif alive; then live=alive; else live=absent; fi
  exit_status=null; [ -s "$dir/exit.status" ] && read -r exit_status <"$dir/exit.status"
  ready_status=null; [ -s "$dir/ready.status" ] && read -r ready_status <"$dir/ready.status"
  printf '{"log_dir":"%s","wait_mode":"%s","session":"%s","exit_status":%s,"ready_status":%s%s}\n' \
    "$(printf '%s' "$dir" | sed 's/[\\"]/\\&/g')" "$mode" "$live" "$exit_status" "$ready_status" "$1"
}
`;
// The audit directory must be the one the launcher wrote for exactly this session.
const owned = (id: string) => String.raw`${prelude(id)}[ "$(field session)" = "$session" ] || { printf '{"unknown_job":true}\n'; exit 0; }
mode=$(field wait_mode)
socket=$(field socket)
`;
// The loop is bounded on the host, so a cancelled client leaves nothing waiting forever.
const waiting = (id: string, until: "ready" | "exit", seconds: number) => String.raw`${owned(id)}end=$((SECONDS + ${seconds}))
while [ ! -s "$dir/exit.status" ] && [ "$SECONDS" -lt "$end" ] && alive; do
${until === "ready" ? String.raw`  case "$mode" in exit|none) break ;; esac
  [ -s "$dir/ready.status" ] && break
` : ""}  sleep 0.2
done
report ""
`;

const instructions = `Use tools.job({route, request}) to run a server, watcher or long command detached in tmux. route is {kind:"local"} or {kind:"ssh", host} with an exact, user-authorized host. Jobs need a POSIX host with tmux: on a Windows machine use an SSH route or ask the user, and never background with & or Start-Process.
start {command, cwd, ready?} runs command, an argv, in the absolute cwd; wrap shell syntax as ["bash","-c","..."], not -lc. ready is what start waits for, default {kind:"exit"}: {kind:"exit"} for commands that finish, {kind:"http", url, expect?} (better than port), {kind:"port", port}, {kind:"log", pattern} (extended regex) or {kind:"none"}; all but none take timeout_ms (default 60000, max 600000). It returns job {id, session, log_dir, state, exit_status, ready} and waited: reached, not_reached or not_requested. Keep job.id: wait {job, until:"ready"|"exit", timeout_ms?} returns reached, read {job, lines?} the last output lines (default 80), stop {job} ends the job and returns stopped.
The session ends with the command; logs stay. state is running, exited (exit_status is the command's code; non-zero means it failed), gone (ended without an exit status: stopped or killed) or unknown. ready is ready, failed, pending or not_applicable (exit and none). not_reached with state running means it is still running: use wait or read.
Errors are ok:false with a code; launch_rejected means nothing was started. On any other error inspect with read or wait (a failed start names its job in error.recovery) and never start again automatically. When leaving a job running, report session and log_dir (tmux attach -t <session>; <log_dir>/pane.log).`;

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "job", label: "Background job", exposure: "deferred",
    namespace: { name: "job", description: "Detached background jobs with readiness and exit signals.", instructions },
    description: "Start a server, watcher or long-running command as a detached tmux job with an exit/HTTP/port/log readiness signal, then wait for, read or stop it by job id, locally or on an exact SSH host.",
    parameters, outputSchema,
    async execute(_id, { route, request }, signal) {
      let recovery: Static<typeof recoverySchema> | null = null;
      const run = async <T extends TSchema>(script: string, timeout: number, schema: T) => {
        const { executable, argv } = route.kind === "local" ? { executable: "bash", argv: ["-s"] } : ssh(route.host, "exec bash -s");
        const result = await execute(executable, argv, script, timeout, signal);
        if (result.cancelled) throw new JobFailure("cancelled", "The call was cancelled; a detached job is not stopped by that.", result);
        if (result.timed_out) throw new JobFailure("timeout", "The transport deadline expired; this says nothing about the job.", result);
        if (result.output_limited) throw new JobFailure("output_limit", "Output exceeded the bounded transport limit.", result);
        if (result.exit_code !== 0 || result.signal !== null || result.spawn_error !== null) {
          throw new JobFailure("transport_error", result.spawn_error ?? `Transport failed (exit ${result.exit_code}, signal ${result.signal}).`, result);
        }
        const newline = result.stdout.indexOf("\n");
        let status: unknown;
        try {
          status = JSON.parse(result.stdout.slice(0, newline));
        } catch {
          throw new JobFailure("invalid_response", "The host did not return a job status line.", result);
        }
        if (Check(unknownJobSchema, status)) throw new JobFailure("unknown_job", "No job created by this tool has that id on this host.");
        if (!Check(schema, status)) throw new JobFailure("invalid_response", "The job status line did not match the expected contract.", result);
        return { status, text: result.stdout.slice(newline + 1), stderr: result.stderr.trim() };
      };
      const receipt = (id: string, status: Static<typeof statusSchema>): Static<typeof jobSchema> => ({
        id, session: `pi-job-${id}`, log_dir: status.log_dir,
        state: status.exit_status !== null ? "exited" : ({ alive: "running", absent: "gone", unknown: "unknown" } as const)[status.session],
        exit_status: status.exit_status,
        // A job that ended before its watcher's verdict never became ready.
        ready: status.wait_mode === "exit" || status.wait_mode === "none" ? "not_applicable"
          : status.ready_status === 0 ? "ready"
          : status.ready_status !== null || status.exit_status !== null || status.session === "absent" ? "failed" : "pending",
      });
      const wait = async (id: string, until: "ready" | "exit", seconds: number) => {
        // Login-shell startup and connection setup come on top of the host-side wait.
        const job = receipt(id, (await run(waiting(id, until, seconds), seconds * 1000 + 20000, statusSchema)).status);
        return { job, reached: until === "exit" ? job.exit_status !== null : job.ready === "ready" };
      };
      let output: Static<typeof outputSchema>;
      try {
        if (route.kind === "local" && process.platform === "win32") {
          throw new JobFailure("local_route_unavailable", "Background jobs need a POSIX host with tmux; from Windows use an SSH route.");
        }
        let data: Static<typeof dataSchema>;
        switch (request.operation) {
          case "start": {
            const ready: Static<typeof readySchema> = request.ready ?? { kind: "exit" };
            const id = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${randomBytes(4).toString("hex")}`;
            const seconds = ready.kind === "none" ? 0 : Math.ceil((ready.timeout_ms ?? 60000) / 1000);
            const signalArgs = ready.kind === "http" ? ["--url", ready.url, ...(ready.expect === undefined ? [] : ["--expect-regex", ready.expect])]
              : ready.kind === "port" ? ["--port", String(ready.port)] : ready.kind === "log" ? ["--pattern", ready.pattern] : [];
            // Each job carries the launcher that started it: a host needs tmux, not a matching checkout.
            const mark = `PI_JOB_${randomBytes(8).toString("hex")}`;
            const scripts = await Promise.all(["tmux-background.sh", "pipe-pane-watch.sh", "wait-for-http.sh", "wait-for-port.sh"].map(async (name) => {
              const body = await readFile(new URL(`../skills/tmux-background/scripts/${name}`, import.meta.url), "utf8");
              return `cat >"$dir/scripts/${name}" <<'${mark}'\n${body}${body.endsWith("\n") ? "" : "\n"}${mark}\n`;
            }));
            const launch = ["--session", `pi-job-${id}`, "--detach", "--cwd", request.cwd, "--wait", ready.kind, "--timeout", String(seconds), ...signalArgs, "--", ...request.command];
            // From here the job may exist whatever happens to this call.
            recovery = { job: id, session: `pi-job-${id}`, log_dir: `~/.cache/pi/tmux-background/pi-job-${id}` };
            // mkdir without -p claims the directory: an existing one is never reused. The launcher's stdin is
            // not the script bash is reading. Launcher exits 2, 3, 4 and 127 precede session creation.
            const { status, stderr } = await run(String.raw`${prelude(id)}mkdir -p "$root" && mkdir "$dir" "$dir/scripts" || { printf '{"rejected":true}\n'; exit 0; }
${scripts.join("")}bash "$dir/scripts/tmux-background.sh" --log-dir "$dir" ${launch.map(quote).join(" ")} </dev/null >"$dir/launch.log" 2>&1
rc=$?
[ "$rc" -eq 0 ] || tail -c 2000 "$dir/launch.log" >&2
case "$rc" in 2|3|4|127) printf '{"rejected":true}\n'; exit 0 ;; esac
mode=${ready.kind}
socket=$(field socket)
report ",\"launcher_exit\":$rc"
`, 30000, startStatusSchema);
            if ("rejected" in status) {
              recovery = null;
              throw new JobFailure("launch_rejected", `Nothing was started and no session was created. ${stderr}`);
            }
            if (status.launcher_exit !== 0) {
              throw new JobFailure("launch_incomplete", `Setup failed after the tmux session was created (launcher exit ${status.launcher_exit}), so a session may remain. ${stderr}`);
            }
            const job = receipt(id, status);
            if (ready.kind === "none") {
              data = { operation: request.operation, job, waited: "not_requested" };
              break;
            }
            // The watcher records its own timeout verdict; give it time to land before giving up.
            const waited = ready.kind === "exit" ? await wait(id, "exit", seconds) : await wait(id, "ready", seconds + 2);
            data = { operation: request.operation, job: waited.job, waited: waited.reached ? "reached" : "not_reached" };
            break;
          }
          case "wait": {
            data = { operation: request.operation, ...await wait(request.job, request.until, Math.ceil((request.timeout_ms ?? 60000) / 1000)) };
            break;
          }
          case "read": {
            // Bounded in lines and bytes on the host; ANSI is stripped as the readiness watcher does.
            const { status, text } = await run(`${owned(request.job)}report ""\ntail -n ${request.lines ?? 80} "$dir/pane.log" | tail -c 30000\n`, 20000, statusSchema);
            data = { operation: request.operation, job: receipt(request.job, status), text: text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replaceAll("\r", "") };
            break;
          }
          case "stop": {
            // Exactly the recorded server and session name; killing the session also ends its readiness watcher.
            const { status } = await run(String.raw`${owned(request.job)}stopped=false
[ -n "$socket" ] && tmux -S "$socket" kill-session -t "=$session" 2>/dev/null && stopped=true
report ",\"stopped\":$stopped"
`, 20000, stopStatusSchema);
            data = { operation: request.operation, job: receipt(request.job, status), stopped: status.stopped };
            break;
          }
        }
        output = { ok: true, route, data };
      } catch (error) {
        const transport = error instanceof JobFailure ? error.transport : null;
        output = {
          ok: false, route, operation: request.operation,
          error: {
            code: error instanceof JobFailure ? error.code : "internal_error",
            message: error instanceof Error ? error.message : String(error),
            transport: transport && {
              exit_code: transport.exit_code, signal: transport.signal, timed_out: transport.timed_out,
              cancelled: transport.cancelled, stderr: transport.stderr.slice(-2000),
            },
            recovery,
          },
        };
      }
      const text = output.ok && output.data.operation === "read"
        ? `${JSON.stringify({ ...output.data, text: undefined })}\n${output.data.text}` : JSON.stringify(output, null, 2);
      return { content: [{ type: "text" as const, text }], details: undefined, structuredContent: output, isError: !output.ok };
    },
  }));
}
