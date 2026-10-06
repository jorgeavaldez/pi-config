import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";

const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum returned records (default 20)." }));
const revision = Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]+$" });
const path = Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]+$", description: "Literal workspace-relative path, not a fileset expression." });
const paths = Type.Optional(Type.Array(path, { minItems: 1, maxItems: 100 }));
const comparison = Type.Union([
  Type.Object({ kind: Type.Literal("revisions"), revset: revision }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("range"), from: revision, to: revision }, { additionalProperties: false }),
]);
const Parameters = Type.Object({
  repository: Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]+$", description: "Explicit absolute repository/workspace directory." }),
  max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 50_000, description: "Maximum captured stdout bytes per command (default 32768)." })),
  request: Type.Union([
    Type.Object({ operation: Type.Literal("status") }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("log"), revset: revision, paths, limit }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("diff"), comparison, format: Type.Literal("patch"), paths }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("diff"), comparison, format: Type.Literal("files"), paths, limit }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("show"), revision }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("file_show"), revision, path }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("bookmark_list"), revset: Type.Optional(revision), names: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]+$" }), { minItems: 1, maxItems: 100 })), limit }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });

const Signature = Type.Object({ name: Type.String(), email: Type.String(), timestamp: Type.String() }, { additionalProperties: false });
const Commit = Type.Object({
  commit_id: Type.String(), change_id: Type.String(), parents: Type.Array(Type.String()),
  description: Type.String(), author: Signature, committer: Signature,
}, { additionalProperties: false });
const Bookmark = Type.Object({
  name: Type.String(), remote: Type.Union([Type.String(), Type.Null()]),
  present: Type.Boolean(), conflict: Type.Boolean(),
  added_targets: Type.Array(Type.String()), removed_targets: Type.Array(Type.String()),
  tracked: Type.Boolean(), tracking_present: Type.Boolean(), synced: Type.Boolean(),
}, { additionalProperties: false });
const fileType = Type.Union([Type.Literal(""), Type.Literal("file"), Type.Literal("symlink"), Type.Literal("tree"), Type.Literal("git-submodule"), Type.Literal("conflict")]);
const ChangedFile = Type.Object({
  path: Type.String(), status: Type.Union([Type.Literal("modified"), Type.Literal("added"), Type.Literal("removed"), Type.Literal("copied"), Type.Literal("renamed")]),
  source_path: Type.String(), source_type: fileType, target_type: fileType,
  source_conflict: Type.Boolean(), target_conflict: Type.Boolean(),
}, { additionalProperties: false });
const ConflictedFile = Type.Object({ path: Type.String(), conflict_side_count: Type.Integer() }, { additionalProperties: false });
const Revision = Type.Object({
  revision: Commit, parents: Type.Array(Commit), current_working_copy: Type.Boolean(),
  conflict: Type.Boolean(), empty: Type.Boolean(), divergent: Type.Boolean(), immutable: Type.Boolean(),
  local_bookmarks: Type.Array(Bookmark), remote_bookmarks: Type.Array(Bookmark),
  changed_files: Type.Array(ChangedFile), conflicted_files: Type.Array(ConflictedFile),
}, { additionalProperties: false });
const BoundedText = Type.Object({
  text: Type.String(), bytes_observed: Type.Integer(), truncated: Type.Boolean(), complete: Type.Boolean(),
  encoding: Type.Literal("utf-8-replacement"),
}, { additionalProperties: false });
const Command = Type.Object({
  argv: Type.Array(Type.String()), exit_code: Type.Union([Type.Integer(), Type.Null()]),
  signal: Type.Union([Type.String(), Type.Null()]), stderr: BoundedText,
}, { additionalProperties: false });
const success = { ok: Type.Literal(true), repository: Type.String(), commands: Type.Array(Command), complete: Type.Boolean() };
const Result = Type.Union([
  Type.Object({ ...success, operation: Type.Literal("status"), status: Revision }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("log"), revisions: Type.Array(Revision) }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("show"), revision: Revision, patch: BoundedText }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("diff"), format: Type.Literal("patch"), patch: BoundedText }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("diff"), format: Type.Literal("files"), files: Type.Array(ChangedFile) }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("file_show"), revision: Type.String(), path: Type.String(), body: BoundedText }, { additionalProperties: false }),
  Type.Object({ ...success, operation: Type.Literal("bookmark_list"), bookmarks: Type.Array(Bookmark) }, { additionalProperties: false }),
  Type.Object({
    ok: Type.Literal(false),
    error: Type.Object({ kind: Type.Union([Type.Literal("invalid_request"), Type.Literal("cancelled"), Type.Literal("timeout"), Type.Literal("spawn"), Type.Literal("exit"), Type.Literal("invalid_output"), Type.Literal("output_limit")]), message: Type.String() }, { additionalProperties: false }),
    commands: Type.Array(Command), stdout: BoundedText,
  }, { additionalProperties: false }),
]);

// Use documented installed template methods and json() escaping, not display templates.
// Commit's native JSON supplies full IDs, description, signatures and parent IDs.
const bookmarkTemplate = String.raw`"{\"name\":" ++ json(self.name()) ++ ",\"remote\":" ++ json(self.remote()) ++ ",\"present\":" ++ json(self.present()) ++ ",\"conflict\":" ++ json(self.conflict()) ++ ",\"added_targets\":" ++ json(self.added_targets().map(|c| c.commit_id())) ++ ",\"removed_targets\":" ++ json(self.removed_targets().map(|c| c.commit_id())) ++ ",\"tracked\":" ++ json(self.tracked()) ++ ",\"tracking_present\":" ++ json(self.tracking_present()) ++ ",\"synced\":" ++ json(self.synced()) ++ "}"`;
const changedFileTemplate = String.raw`"{\"path\":" ++ json(self.path()) ++ ",\"status\":" ++ json(self.status()) ++ ",\"source_path\":" ++ json(self.source().path()) ++ ",\"source_type\":" ++ json(self.source().file_type()) ++ ",\"target_type\":" ++ json(self.target().file_type()) ++ ",\"source_conflict\":" ++ json(self.source().conflict()) ++ ",\"target_conflict\":" ++ json(self.target().conflict()) ++ "}"`;
const revisionTemplate = String.raw`"{\"revision\":" ++ json(self) ++ ",\"parents\":" ++ json(parents) ++ ",\"current_working_copy\":" ++ json(current_working_copy) ++ ",\"conflict\":" ++ json(conflict) ++ ",\"empty\":" ++ json(empty) ++ ",\"divergent\":" ++ json(divergent) ++ ",\"immutable\":" ++ json(immutable) ++ ",\"local_bookmarks\":[" ++ local_bookmarks.map(|b| ${bookmarkTemplate.replaceAll("self.", "b.")}).join(",") ++ "],\"remote_bookmarks\":[" ++ remote_bookmarks.map(|b| ${bookmarkTemplate.replaceAll("self.", "b.")}).join(",") ++ "],\"changed_files\":[" ++ self.diff().files().map(|f| ${changedFileTemplate.replaceAll("self.", "f.")}).join(",") ++ "],\"conflicted_files\":[" ++ conflicted_files.map(|f| "{\"path\":" ++ json(f.path()) ++ ",\"conflict_side_count\":" ++ json(f.conflict_side_count()) ++ "}").join(",") ++ "]}\n"`;

const emptyText: Static<typeof BoundedText> = { text: "", bytes_observed: 0, truncated: false, complete: true, encoding: "utf-8-replacement" };

type ProcessResult = {
  command: Static<typeof Command>;
  stdout: Static<typeof BoundedText>;
  failure: "cancelled" | "timeout" | "spawn" | "exit" | null;
  message: string;
};

// Stream into capped buffers while draining the pipes: truncation does not invent an exit code.
async function runJj(repository: string, args: string[], maxBytes: number, signal?: AbortSignal): Promise<ProcessResult> {
  const argv = ["--repository=" + repository, "--no-pager", "--color=never", ...args];
  if (signal?.aborted) {
    return { command: { argv, exit_code: null, signal: null, stderr: { ...emptyText, complete: false } }, stdout: { ...emptyText, complete: false }, failure: "cancelled", message: "Inspection cancelled before starting jj." };
  }
  return new Promise((resolve) => {
    const child = spawn("jj", argv, { cwd: repository, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: ProcessResult["failure"] = null;
    let message = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: "cancelled" | "timeout") => {
      if (failure) return;
      failure = reason;
      message = reason === "cancelled" ? "Inspection cancelled." : "jj exceeded the 15 second inspection deadline.";
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
    };
    const cancel = () => stop("cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => stop("timeout"), 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < maxBytes) stdout.push(chunk.subarray(0, maxBytes - stdoutBytes));
      stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 8192) stderr.push(chunk.subarray(0, 8192 - stderrBytes));
      stderrBytes += chunk.length;
    });
    child.on("error", (error) => {
      failure ??= "spawn";
      message ||= error.message;
    });
    child.on("close", (code, processSignal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      const completed = failure === null && processSignal === null;
      if (!failure && (code !== 0 || processSignal)) {
        failure = "exit";
        message = processSignal ? `jj terminated by ${processSignal}.` : `jj exited with code ${code}.`;
      }
      // Streaming decode omits a split final UTF-8 character, instead of adding a spurious replacement.
      const outputTruncated = stdoutBytes > maxBytes;
      const errorTruncated = stderrBytes > 8192;
      resolve({
        command: {
          argv, exit_code: code, signal: processSignal,
          stderr: { text: new TextDecoder().decode(Buffer.concat(stderr), { stream: errorTruncated }), bytes_observed: stderrBytes, truncated: errorTruncated, complete: completed && !errorTruncated, encoding: "utf-8-replacement" },
        },
        stdout: { text: new TextDecoder().decode(Buffer.concat(stdout), { stream: outputTruncated }), bytes_observed: stdoutBytes, truncated: outputTruncated, complete: completed && !outputTruncated, encoding: "utf-8-replacement" },
        failure, message,
      });
    });
  });
}

// NDJSON templates delimit records even when descriptions or paths contain newlines.
function parseRows<T extends TSchema>(schema: T, stdout: Static<typeof BoundedText>, limit: number): { rows: Static<T>[]; complete: boolean } {
  const lines = stdout.text.split("\n");
  const tail = lines.pop();
  if (!stdout.truncated && tail !== "") throw new Error("jj template output was missing its final record delimiter.");
  const rows: Static<T>[] = [];
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    if (!Check(schema, value)) throw new Error("jj template output did not match the installed machine-data contract.");
    rows.push(value);
  }
  return { rows: rows.slice(0, limit), complete: !stdout.truncated && rows.length <= limit };
}

// jj literals support neither JSON's \b/\f nor \u escapes. Escape only the
// delimiter/backslash; all other UTF-8 characters can appear literally.
function literalFileset(kind: "root" | "root-file", value: string): string {
  return `${kind}:"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function respond(result: Static<typeof Result>) {
  const fullText = JSON.stringify(result);
  let text = fullText;
  if (truncateHead(fullText).truncated) {
    const fullOutputPath = join(await mkdtemp(join(tmpdir(), "pi-jj-")), "output.json");
    await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, fullText, "utf8"));
    const notice = `\n\n[Model-facing output truncated. Full result saved to: ${fullOutputPath}]`;
    text = truncateHead(fullText, {
      maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice),
      maxLines: DEFAULT_MAX_LINES - 2,
    }).content + notice;
  }
  return { content: [{ type: "text" as const, text }], details: result, structuredContent: result, isError: !result.ok };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jj",
    label: "jj inspection",
    description: "Read-only Jujutsu repository inspection: status, log, diff, show, file contents and local/remote bookmarks. Structured results; bounded patches and file bodies.",
    exposure: "deferred",
    namespace: {
      name: "jj",
      description: "Read-only Jujutsu version-control inspection.",
      instructions: "Pass an absolute repository directory and an operation-specific request. Revisions/revsets are jj expressions; paths and bookmark names are literal, never argv or fileset expressions. status inspects @; log requires a revset; show requires exactly one revision. diff chooses a revisions revset or an explicit from/to range, and patch or files output. bookmark_list includes all remotes. Uses ordinary jj behavior, including working-copy snapshotting. show resolves metadata then reads the patch by full commit ID. Compose independent inspections in codemode. complete=false means a byte/record limit or interrupted output; stderr, actual exit code and signal are retained. Stdout defaults to 32768 bytes per command (max 50000), stderr to 8192; record limits default to 20 (max 100). Model-facing JSON is capped at 50 KiB/2000 lines with full-result file recovery; structured data is unchanged. Commands have a 15 second deadline and honor cancellation. Text uses UTF-8 replacement decoding, not binary-safe file transport. Errors return ok=false with isError and structuredContent, not success-looking terminal strings.",
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Parameters,
    outputSchema: Result,
    async execute(_id, params, signal) {
      if (!Check(Parameters, params) || !isAbsolute(params.repository)) {
        return respond({ ok: false, error: { kind: "invalid_request", message: "Provide an absolute repository path and a supported operation-specific request; extra fields are not accepted." }, commands: [], stdout: emptyText });
      }
      const { repository, request } = params;
      const maxBytes = params.max_bytes ?? 32768;
      const commands: Static<typeof Command>[] = [];
      let output = emptyText;
      const base = { ok: true as const, repository, commands };
      let args: string[];
      switch (request.operation) {
        case "status":
          args = ["log", "--no-graph", "--revisions=@", "--limit=1", "--template", revisionTemplate];
          break;
        case "log":
          args = ["log", "--no-graph", "--revisions=" + request.revset, "--limit=" + ((request.limit ?? 20) + 1), "--template", revisionTemplate, "--", ...(request.paths ?? []).map((p) => literalFileset("root", p))];
          break;
        case "show":
          args = ["log", "--no-graph", "--revisions=" + request.revision, "--limit=2", "--template", revisionTemplate];
          break;
        case "diff":
          args = ["diff", ...(request.comparison.kind === "revisions" ? ["--revisions=" + request.comparison.revset] : ["--from=" + request.comparison.from, "--to=" + request.comparison.to]), ...(request.format === "patch" ? ["--git"] : ["--template", changedFileTemplate + ' ++ "\\n"']), "--", ...(request.paths ?? []).map((p) => literalFileset("root", p))];
          break;
        case "file_show":
          args = ["file", "show", "--revision=" + request.revision, "--template", '""', "--", literalFileset("root-file", request.path)];
          break;
        case "bookmark_list":
          args = ["bookmark", "list", "--all-remotes", "--sort=name", "--template", bookmarkTemplate + ' ++ "\\n"', ...(request.revset ? ["--revision=" + request.revset] : []), "--", ...(request.names ?? []).map((name) => "exact:" + name)];
          break;
      }
      try {
        const result = await runJj(repository, args, maxBytes, signal);
        commands.push(result.command);
        output = result.stdout;
        if (result.failure) return respond({ ok: false, error: { kind: result.failure, message: result.message }, commands, stdout: output });
        switch (request.operation) {
          case "status":
          case "show": {
            const parsed = parseRows(Revision, output, 2);
            if (!parsed.complete) return respond({ ok: false, error: { kind: "output_limit", message: "No complete revision metadata record was available within the output bound." }, commands, stdout: output });
            if (request.operation === "show" && parsed.rows.length !== 1) return respond({ ok: false, error: { kind: "invalid_request", message: "show requires a revset resolving to exactly one revision." }, commands, stdout: output });
            const current = parsed.rows[0];
            if (!current) return respond({ ok: false, error: { kind: "invalid_output", message: "jj did not return the working-copy revision." }, commands, stdout: output });
            if (request.operation === "status") return respond({ ...base, operation: "status", status: current, complete: true });
            const patch = await runJj(repository, ["diff", "--git", "--revisions=" + current.revision.commit_id], maxBytes, signal);
            commands.push(patch.command);
            output = patch.stdout;
            if (patch.failure) return respond({ ok: false, error: { kind: patch.failure, message: patch.message }, commands, stdout: output });
            return respond({ ...base, operation: "show", revision: current, patch: output, complete: output.complete });
          }
          case "log": {
            const parsed = parseRows(Revision, output, request.limit ?? 20);
            return respond({ ...base, operation: "log", revisions: parsed.rows, complete: parsed.complete });
          }
          case "diff": {
            if (request.format === "patch") return respond({ ...base, operation: "diff", format: "patch", patch: output, complete: output.complete });
            const parsed = parseRows(ChangedFile, output, request.limit ?? 20);
            return respond({ ...base, operation: "diff", format: "files", files: parsed.rows, complete: parsed.complete });
          }
          case "file_show":
            return respond({ ...base, operation: "file_show", revision: request.revision, path: request.path, body: output, complete: output.complete });
          case "bookmark_list": {
            const parsed = parseRows(Bookmark, output, request.limit ?? 20);
            return respond({ ...base, operation: "bookmark_list", bookmarks: parsed.rows, complete: parsed.complete });
          }
        }
      } catch (error) {
        return respond({ ok: false, error: { kind: "invalid_output", message: error instanceof Error ? error.message : String(error) }, commands, stdout: output });
      }
    },
  });
}
