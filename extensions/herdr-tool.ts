import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, formatSize, truncateHead, type ExtensionAPI, type TruncationResult } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Check, Clean } from "typebox/value";

const strict = { additionalProperties: false };
const workspaceId = Type.String({ pattern: "^w[A-Za-z0-9]+$" });
const paneId = Type.String({ pattern: "^w[A-Za-z0-9]+:p[A-Za-z0-9]+$" });
const sessionRef = Type.Object({
  source: Type.String(), agent: Type.String(),
  kind: Type.Union([Type.Literal("id"), Type.Literal("path")]), value: Type.String({ minLength: 1 }),
}, strict);
const status = Type.Union([
  Type.Literal("idle"), Type.Literal("working"), Type.Literal("blocked"),
  Type.Literal("done"), Type.Literal("unknown"),
]);
const nullableText = Type.Union([Type.String(), Type.Null()]);
const paneFields = {
  pane_id: paneId, terminal_id: Type.String(), workspace_id: workspaceId, tab_id: Type.String(),
  focused: Type.Boolean(), agent_status: status, revision: Type.Integer({ minimum: 0 }),
  agent: Type.Optional(nullableText), cwd: Type.Optional(nullableText),
  foreground_cwd: Type.Optional(nullableText),
  agent_session: Type.Optional(Type.Union([sessionRef, Type.Null()])),
};
const pane = Type.Object(paneFields, strict);
const agent = Type.Object({
  ...paneFields, name: Type.Optional(nullableText), interactive_ready: Type.Optional(Type.Boolean()),
  launch_pending: Type.Optional(Type.Boolean()), state_change_seq: Type.Optional(Type.Integer({ minimum: 0 })),
  completion_seq: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
}, strict);
const workspace = Type.Object({
  workspace_id: workspaceId, number: Type.Integer({ minimum: 0 }), label: Type.String(),
  focused: Type.Boolean(), pane_count: Type.Integer({ minimum: 0 }), tab_count: Type.Integer({ minimum: 0 }),
  active_tab_id: Type.String(), agent_status: status,
}, strict);
const tab = Type.Object({
  tab_id: Type.String(), workspace_id: workspaceId, number: Type.Integer({ minimum: 0 }),
  label: Type.String(), focused: Type.Boolean(), pane_count: Type.Integer({ minimum: 0 }), agent_status: status,
}, strict);
const routeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("local") }, strict),
  Type.Object({
    kind: Type.Literal("ssh"),
    host: Type.String({ pattern: "^[A-Za-z0-9_][A-Za-z0-9_.@:\\[\\]-]*$", maxLength: 255 }),
    session: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", maxLength: 128 }),
  }, strict),
]);
const readSource = Type.Union([Type.Literal("visible"), Type.Literal("recent"), Type.Literal("recent-unwrapped")]);
const shortDeadline = Type.Integer({ minimum: 1, maximum: 30000, description: "Overall deadline in milliseconds, including route verification." });
const waitDeadline = Type.Integer({ minimum: 1, maximum: 600000, description: "Overall deadline in milliseconds; allow transport overhead in the caller." });
const readFields = { pane_id: paneId, source: readSource, lines: Type.Integer({ minimum: 1, maximum: 500 }), timeout_ms: shortDeadline };
const requestSchema = Type.Union([
  Type.Object({ operation: Type.Literal("workspace_list"), timeout_ms: shortDeadline }, strict),
  Type.Object({ operation: Type.Literal("tab_list"), workspace_id: workspaceId, timeout_ms: shortDeadline }, strict),
  Type.Object({ operation: Type.Literal("pane_list"), workspace_id: workspaceId, timeout_ms: shortDeadline }, strict),
  Type.Object({ operation: Type.Literal("pane_get"), pane_id: paneId, timeout_ms: shortDeadline }, strict),
  Type.Object({ operation: Type.Literal("pane_read"), ...readFields }, strict),
  Type.Object({ operation: Type.Literal("agent_get"), pane_id: paneId, timeout_ms: shortDeadline }, strict),
  Type.Object({ operation: Type.Literal("agent_read"), ...readFields }, strict),
  Type.Object({ operation: Type.Literal("agent_wait"), pane_id: paneId, timeout_ms: waitDeadline }, strict),
  Type.Object({
    operation: Type.Literal("agent_prompt"), pane_id: paneId, timeout_ms: waitDeadline,
    text: Type.String({ minLength: 1, maxLength: 65536, pattern: "^[^\\u0000]+$" }),
    expected: Type.Object({
      workspace_id: workspaceId, terminal_id: Type.String({ minLength: 1 }),
      cwd: Type.String({ minLength: 1 }), agent_session: sessionRef,
    }, strict),
  }, strict),
]);
const parameters = Type.Object({ route: routeSchema, request: requestSchema }, strict);
type Route = Static<typeof routeSchema>;
const stageSchema = Type.Union([
  Type.Literal("routing"), Type.Literal("session_check"), Type.Literal("preflight"), Type.Literal("request"),
]);
type Stage = Static<typeof stageSchema>;
const transportSchema = Type.Object({
  stdout: Type.String(), stderr: Type.String(), exit_code: Type.Union([Type.Integer(), Type.Null()]),
  signal: nullableText, timed_out: Type.Boolean(), cancelled: Type.Boolean(),
  output_limited: Type.Boolean(), spawn_error: nullableText,
}, strict);
type Transport = Static<typeof transportSchema>;
const commandSchema = Type.Object({
  stage: stageSchema, exit_code: Type.Union([Type.Integer(), Type.Null()]), signal: nullableText,
  stderr: Type.String(),
}, strict);
const dataSchema = Type.Union([
  Type.Object({ operation: Type.Literal("workspace_list"), workspaces: Type.Array(workspace) }, strict),
  Type.Object({ operation: Type.Literal("tab_list"), tabs: Type.Array(tab) }, strict),
  Type.Object({ operation: Type.Literal("pane_list"), panes: Type.Array(pane) }, strict),
  Type.Object({ operation: Type.Literal("pane_get"), pane }, strict),
  Type.Object({ operation: Type.Literal("agent_get"), agent }, strict),
  Type.Object({ operation: Type.Literal("agent_wait"), agent, observation: Type.Literal("current_settled_state") }, strict),
  Type.Object({ operation: Type.Literal("agent_prompt"), agent, observation: Type.Literal("activity_observed_and_settled") }, strict),
  Type.Object({ operation: Type.Literal("pane_read"), pane_id: paneId, source: readSource, lines: Type.Integer(), text: Type.String() }, strict),
  Type.Object({ operation: Type.Literal("agent_read"), pane_id: paneId, source: readSource, lines: Type.Integer(), text: Type.String() }, strict),
]);
const operationSchema = Type.Union([
  Type.Literal("workspace_list"), Type.Literal("tab_list"), Type.Literal("pane_list"),
  Type.Literal("pane_get"), Type.Literal("pane_read"), Type.Literal("agent_get"),
  Type.Literal("agent_read"), Type.Literal("agent_wait"), Type.Literal("agent_prompt"),
]);
const outputSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), route: routeSchema, data: dataSchema, commands: Type.Array(commandSchema) }, strict),
  Type.Object({
    ok: Type.Literal(false), route: routeSchema, operation: operationSchema,
    error: Type.Object({
      code: Type.String(), message: Type.String(), stage: stageSchema,
      submission: Type.Union([Type.Literal("not_attempted"), Type.Literal("uncertain")]),
      transport: Type.Union([transportSchema, Type.Null()]),
    }, strict), commands: Type.Array(commandSchema),
  }, strict),
]);
const errorEnvelope = Type.Object({ id: Type.String(), error: Type.Object({ code: Type.String(), message: Type.String() }, strict) }, strict);
const sessionsSchema = Type.Object({ sessions: Type.Array(Type.Object({ name: Type.String(), running: Type.Boolean() }, strict)) }, strict);
const workspacesEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("workspace_list"), workspaces: Type.Array(workspace) }, strict) }, strict);
const tabsEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("tab_list"), tabs: Type.Array(tab) }, strict) }, strict);
const panesEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("pane_list"), panes: Type.Array(pane) }, strict) }, strict);
const paneEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("pane_info"), pane }, strict) }, strict);
const agentEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("agent_info"), agent }, strict) }, strict);
const promptedEnvelope = Type.Object({ id: Type.String(), result: Type.Object({ type: Type.Literal("agent_prompted"), agent }, strict) }, strict);

// A failure keeps command evidence; in particular, cancellation cannot be mistaken for exit zero.
class HerdrFailure extends Error {
  constructor(readonly code: string, message: string, readonly transport: Transport | null = null) {
    super(message);
  }
}

function decode<T extends TSchema>(schema: T, text: string, transport: Transport): Static<T> {
  let value: unknown;
  try {
    value = Clean(schema, JSON.parse(text));
  } catch {
    throw new HerdrFailure("invalid_response", "Herdr did not return valid JSON.", transport);
  }
  if (!Check(schema, value)) throw new HerdrFailure("invalid_response", "Herdr JSON did not match the installed response contract.", transport);
  return value;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

type Argument = string | { prompt: string };

// pi.exec has no stdin transport. A prompt argument is argv locally, stdin remotely, never shell source.
async function transport(route: Route, args: Argument[], timeout: number, signal: AbortSignal | undefined): Promise<Transport> {
  const result: Transport = {
    stdout: "", stderr: "", exit_code: null, signal: null,
    timed_out: false, cancelled: false, output_limited: false, spawn_error: null,
  };
  if (signal?.aborted) return { ...result, cancelled: true };
  let executable = "herdr";
  let argv = args.map((arg) => typeof arg === "string" ? arg : arg.prompt);
  let input = "";
  if (route.kind === "ssh") {
    executable = "ssh";
    const prompt = args.find((arg) => typeof arg !== "string");
    const inner = ["herdr", ...args].map((arg) => typeof arg === "string" ? quote(arg) : '"$prompt"').join(" ");
    // read preserves quotes, substitutions, multiline text and trailing newlines; EOF is expected.
    const script = prompt === undefined ? `exec ${inner}` : `IFS= read -r -d '' prompt || [[ -n "$prompt" ]] || exit 2; exec ${inner}`;
    argv = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", route.host, `zsh -lic ${quote(script)}`];
    input = prompt?.prompt ?? "";
  }
  return new Promise((resolve) => {
    const child = spawn(executable, argv, { stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => { result.cancelled = true; child.kill("SIGKILL"); };
    const timer = setTimeout(() => { result.timed_out = true; child.kill("SIGKILL"); }, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (key: "stdout" | "stderr", chunk: string) => {
      // Bound both diagnostics and reads, including a single unusually long terminal line.
      const room = 262144 - result[key].length;
      result[key] += chunk.slice(0, Math.max(0, room));
      if (chunk.length > room) { result.output_limited = true; child.kill("SIGKILL"); }
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => capture("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => capture("stderr", chunk));
    child.on("error", (error) => { result.spawn_error = error.message; });
    // An early remote exit can close stdin before the prompt is written (EPIPE).
    child.stdin.on("error", (error) => { result.spawn_error ??= error.message; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      result.exit_code = code;
      result.signal = exitSignal;
      resolve(result);
    });
    child.stdin.end(input);
  });
}

const instructions = `Use tools.herdr({route, request}); every request has operation and timeout_ms.
Local requires inherited HERDR_ENV=1 and HERDR_SOCKET_PATH. SSH requires the user-authorized exact host and named running session; the tool verifies it before every call. No fallback, focus changes, creation, startup, shell commands or send-keys.
List workspaces only to locate the task; tab_list/pane_list require workspace_id. All pane/agent operations require a live pane_id, not focus, an agent name or a Pi session UUID. Reads require source and lines (1–500); prefer recent-unwrapped. Lists/gets/reads allow at most 30s; waits/prompts at most 600s. Allow an extra second of transport cleanup plus caller overhead.
Before agent_prompt, get/read the target, consume previous results, verify task ownership and a clean input box. Supply expected workspace_id, terminal_id, cwd and the complete agent_session from agent_get. The tool rechecks identity, interactive readiness and idle/done, then always uses --wait with default settled states and activity detection. It rejects targets observed as working/blocked/unknown at preflight and never prompts itself locally. Preflight is not an atomic reservation and CLI waits are not turn-correlated; keep one dispatcher per target.
Success is a lifecycle observation, not task success. Read the actual result; blocked requires a decision. agent_wait observes current state and may immediately match never-prompted idle: use it only for an already-submitted task whose activity was confirmed. On any error/timeout/cancellation/stall, inspect identity/state/output; delivery may be uncertain. Never automatically resend or infer completion. Results are validated ok:true data or ok:false error variants; commands preserve stderr/exit status. Model-facing text is limited to 50KB/2000 lines with a full-output recovery path when truncated; codemode retains the complete structured result. Use the Herdr skill's CLI route for unsupported operations, retaining its safety policy.`;

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "herdr", label: "Herdr", exposure: "deferred",
    namespace: { name: "herdr", description: "Herdr workspace, pane and agent control.", instructions },
    description: "Inspect Herdr workspaces/tabs/panes and safely read, wait for or prompt verified agents locally or in an exact SSH session.",
    parameters, outputSchema,
    async execute(_id, { route, request }, signal) {
      const commands: Static<typeof commandSchema>[] = [];
      let stage: Stage = "routing";
      let submission: "not_attempted" | "uncertain" = "not_attempted";
      const deadline = Date.now() + request.timeout_ms;
      const run = async (args: Argument[]): Promise<Transport> => {
        const remaining = deadline - Date.now();
        if (signal?.aborted) throw new HerdrFailure("cancelled", "Herdr call was cancelled before this command started.");
        if (remaining <= 0) throw new HerdrFailure("timeout", "Herdr call deadline expired before this command started.");
        const scoped = route.kind === "ssh" && stage !== "session_check" ? ["--session", route.session, ...args] : args;
        if (args.some((arg) => typeof arg !== "string")) submission = "uncertain";
        const result = await transport(route, scoped, remaining + 1000, signal);
        commands.push({ stage, exit_code: result.exit_code, signal: result.signal, stderr: result.stderr });
        if (result.cancelled) throw new HerdrFailure("cancelled", "Herdr command was cancelled; any submitted prompt may still be running.", result);
        if (result.timed_out) throw new HerdrFailure("timeout", "Herdr transport deadline expired; this is not completion.", result);
        if (result.output_limited) throw new HerdrFailure("output_limit", "Herdr output exceeded the bounded transport limit.", result);
        if (result.exit_code !== 0 || result.signal !== null || result.spawn_error !== null) {
          if (result.exit_code === 1 && result.stderr.trim().startsWith("{")) {
            const failure = decode(errorEnvelope, result.stderr, result);
            throw new HerdrFailure(failure.error.code, failure.error.message, result);
          }
          throw new HerdrFailure("transport_error", result.spawn_error ?? `Herdr transport failed (exit ${result.exit_code}, signal ${result.signal}).`, result);
        }
        if (Date.now() > deadline) throw new HerdrFailure("timeout", "Herdr command returned after the requested deadline; this is not completion.", result);
        return result;
      };
      const json = async <T extends TSchema>(args: Argument[], schema: T): Promise<Static<T>> => {
        const result = await run(args);
        return decode(schema, result.stdout, result);
      };
      const report = async (output: Static<typeof outputSchema>) => {
        const fullText = JSON.stringify(output, null, 2);
        const truncation = truncateHead(fullText);
        let text = truncation.content;
        let details: { truncation: TruncationResult; fullOutputPath: string } | undefined;
        if (truncation.truncated) {
          const directory = await mkdtemp(join(tmpdir(), "pi-herdr-"));
          const fullOutputPath = join(directory, "output.json");
          await writeFile(fullOutputPath, fullText, "utf8");
          details = { truncation, fullOutputPath };
          text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output: ${fullOutputPath}]`;
        }
        return {
          content: [{ type: "text" as const, text }],
          details, structuredContent: output, isError: !output.ok,
        };
      };
      try {
        if (route.kind === "local") {
          if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH) {
            throw new HerdrFailure("local_route_unavailable", "Local control requires inherited HERDR_ENV=1 and HERDR_SOCKET_PATH; no focused/default session fallback.");
          }
        } else {
          stage = "session_check";
          const sessions = await json(["session", "list", "--json"], sessionsSchema);
          const matches = sessions.sessions.filter((session) => session.name === route.session);
          if (matches.length !== 1 || matches[0]?.running !== true) {
            throw new HerdrFailure("session_unavailable", "The exact named SSH session must already exist and be running.");
          }
        }
        stage = "request";
        let data: Static<typeof dataSchema>;
        switch (request.operation) {
          case "workspace_list": {
            const response = await json(["workspace", "list"], workspacesEnvelope);
            data = { operation: request.operation, workspaces: response.result.workspaces };
            break;
          }
          case "tab_list": {
            const response = await json(["tab", "list", "--workspace", request.workspace_id], tabsEnvelope);
            if (response.result.tabs.some((tab) => tab.workspace_id !== request.workspace_id)) throw new HerdrFailure("target_mismatch", "Tab list returned another workspace.");
            data = { operation: request.operation, tabs: response.result.tabs };
            break;
          }
          case "pane_list": {
            const response = await json(["pane", "list", "--workspace", request.workspace_id], panesEnvelope);
            if (response.result.panes.some((pane) => pane.workspace_id !== request.workspace_id)) throw new HerdrFailure("target_mismatch", "Pane list returned another workspace.");
            data = { operation: request.operation, panes: response.result.panes };
            break;
          }
          case "pane_get": {
            const response = await json(["pane", "get", request.pane_id], paneEnvelope);
            if (response.result.pane.pane_id !== request.pane_id) throw new HerdrFailure("target_mismatch", "Pane get returned another pane.");
            data = { operation: request.operation, pane: response.result.pane };
            break;
          }
          case "pane_read":
          case "agent_read": {
            const group = request.operation === "pane_read" ? "pane" : "agent";
            const response = await run([group, "read", request.pane_id, "--source", request.source, "--lines", String(request.lines), "--format", "text"]);
            data = { operation: request.operation, pane_id: request.pane_id, source: request.source, lines: request.lines, text: response.stdout };
            break;
          }
          case "agent_get":
          case "agent_wait": {
            const args = request.operation === "agent_get" ? ["agent", "get", request.pane_id]
              : ["agent", "wait", request.pane_id, "--timeout", String(Math.max(1, deadline - Date.now()))];
            const response = await json(args, agentEnvelope);
            if (response.result.agent.pane_id !== request.pane_id) throw new HerdrFailure("target_mismatch", "Agent operation returned another pane.");
            if (request.operation === "agent_wait") {
              if (!["idle", "done", "blocked"].includes(response.result.agent.agent_status)) throw new HerdrFailure("invalid_response", "Agent wait returned a non-settled state.");
              data = { operation: request.operation, agent: response.result.agent, observation: "current_settled_state" };
            } else data = { operation: request.operation, agent: response.result.agent };
            break;
          }
          case "agent_prompt": {
            stage = "preflight";
            if (route.kind === "local" && request.pane_id === process.env.HERDR_PANE_ID) throw new HerdrFailure("self_prompt", "Cannot prompt the local coordinating pane.");
            const { result: { agent: current } } = await json(["agent", "get", request.pane_id], agentEnvelope);
            const expected = request.expected;
            const session = current.agent_session;
            if (current.pane_id !== request.pane_id || current.workspace_id !== expected.workspace_id ||
                current.terminal_id !== expected.terminal_id || current.cwd !== expected.cwd || !session ||
                current.agent !== expected.agent_session.agent || session.agent !== expected.agent_session.agent ||
                session.kind !== expected.agent_session.kind || session.source !== expected.agent_session.source ||
                session.value !== expected.agent_session.value) {
              throw new HerdrFailure("identity_changed", "Target pane, cwd or agent session differs from the verified target.");
            }
            if (!["idle", "done"].includes(current.agent_status) || current.interactive_ready !== true || current.launch_pending === true) {
              throw new HerdrFailure("agent_not_ready", "Target must be interactive-ready and idle/done before prompting.");
            }
            stage = "request";
            const response = await json(["agent", "prompt", request.pane_id, { prompt: request.text }, "--wait", "--timeout", String(Math.max(1, deadline - Date.now()))], promptedEnvelope);
            const settled = response.result.agent;
            if (settled.pane_id !== current.pane_id || settled.terminal_id !== current.terminal_id ||
                settled.agent_session?.value !== session.value || settled.agent_session?.kind !== session.kind ||
                settled.agent_session?.agent !== session.agent || settled.agent_session?.source !== session.source ||
                !["idle", "done", "blocked"].includes(settled.agent_status)) {
              throw new HerdrFailure("identity_or_state_changed", "Prompt wait returned another identity or a non-settled state.");
            }
            data = { operation: request.operation, agent: settled, observation: "activity_observed_and_settled" };
            break;
          }
        }
        return await report({ ok: true, route, data, commands });
      } catch (error) {
        return report({
          ok: false, route, operation: request.operation,
          error: {
            code: error instanceof HerdrFailure ? error.code : "internal_error",
            message: error instanceof Error ? error.message : String(error), stage, submission,
            transport: error instanceof HerdrFailure ? error.transport : null,
          }, commands,
        });
      }
    },
  }));
}
