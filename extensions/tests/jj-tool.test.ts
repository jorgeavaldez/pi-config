import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, discoverAndLoadExtensions, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager, wrapRegisteredTool, type ExecuteToolOptions, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check, Parse } from "typebox/value";

const extensionPath = fileURLToPath(new URL("../jj-tool.ts", import.meta.url));
const commit = {
  commit_id: "a".repeat(40), change_id: "z".repeat(32), parents: ["b".repeat(40)],
  description: "quotes \" and\nnewlines\n", author: { name: "Jorge", email: "j@example.com", timestamp: "2026-10-06T00:00:00Z" },
  committer: { name: "Jorge", email: "j@example.com", timestamp: "2026-10-06T00:00:00Z" },
};
const bookmark = {
  name: "feature", remote: null, present: true, conflict: true, added_targets: [commit.commit_id, "c".repeat(40)],
  removed_targets: ["b".repeat(40)], tracked: false, tracking_present: false, synced: false,
};
const changedFile = { path: "new\n\"name.txt", status: "renamed", source_path: "old.txt", source_type: "file", target_type: "conflict", source_conflict: false, target_conflict: true };
const revision = {
  revision: commit, parents: [{ ...commit, commit_id: "b".repeat(40), parents: [] }],
  current_working_copy: true, conflict: true, empty: false, divergent: false, immutable: false,
  local_bookmarks: [bookmark], remote_bookmarks: [{ ...bookmark, remote: "origin", tracked: true }],
  changed_files: [changedFile], conflicted_files: [{ path: changedFile.path, conflict_side_count: 2 }],
};
const ndjson = (values: object[]) => values.map((value) => JSON.stringify(value) + "\n").join("");
const TextOutput = Type.Object({ text: Type.String(), bytes_observed: Type.Integer(), truncated: Type.Boolean(), complete: Type.Boolean(), encoding: Type.Literal("utf-8-replacement") });
const Diagnostics = Type.Array(Type.Object({ argv: Type.Array(Type.String()), exit_code: Type.Union([Type.Integer(), Type.Null()]), signal: Type.Union([Type.String(), Type.Null()]), stderr: TextOutput }));
const ErrorOutput = Type.Object({ ok: Type.Literal(false), error: Type.Object({ kind: Type.String(), message: Type.String() }), commands: Diagnostics, stdout: TextOutput });
const Calls = Type.Array(Type.Object({ args: Type.Array(Type.String()), cwd: Type.String() }));

// The fake jj is an extensionless shebang script, which Windows cannot spawn; the real jj would run instead.
const posixFixtures = process.platform === "win32" ? "fake jj fixture is a POSIX shebang script" : false;
async function setup(t: TestContext, fake = true) {
  const root = mkdtempSync(join(tmpdir(), "pi-jj-tool-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configPath = join(root, "response.json");
  const callsPath = join(root, "calls.jsonl");
  const readyPath = join(root, "ready");
  const bin = join(root, "bin");
  if (fake) {
    mkdirSync(bin);
    writeFileSync(join(bin, "jj"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({args, cwd: process.cwd()}) + "\\n");
const response = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));
if (response.wait) {
  process.stdout.write(response.stdout ?? "", () => {
    process.stderr.write(response.stderr ?? "", () => fs.writeFileSync(${JSON.stringify(readyPath)}, "ready"));
  });
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(args.includes("--git") && response.patch !== undefined ? response.patch : (response.stdout ?? ""));
  process.stderr.write(response.stderr ?? "");
  process.exitCode = response.code ?? 0;
}
`, { mode: 0o755 });
    writeFileSync(configPath, JSON.stringify({ stdout: ndjson([revision]) }));
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    t.after(() => { process.env.PATH = oldPath; });
  }
  const loaded = await discoverAndLoadExtensions([extensionPath], root, root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.ok(extension);
  assert.equal(extension.tools.size, 1);
  const registered = extension.tools.get("jj");
  assert.ok(registered);
  const models = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  loaded.runtime.getThinkingLevel = () => "off";
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.create(root, join(root, "sessions")), new ModelRegistry(models));
  const tool = wrapRegisteredTool(registered, runner);
  const call = async (request: object, max_bytes?: number, signal?: AbortSignal, repo = root) => {
    const result = await tool.execute("inspection", { repository: repo, request, ...(max_bytes === undefined ? {} : { max_bytes }) }, signal);
    assert.ok(registered.definition.outputSchema);
    assert.ok(Check(registered.definition.outputSchema, result.structuredContent), JSON.stringify(result));
    assert.deepEqual(result.details, result.structuredContent);
    return result;
  };
  return {
    root, bin, tool, runner, definition: registered.definition, sourceInfo: registered.sourceInfo, call,
    respond(response: { stdout?: string; stderr?: string; code?: number; patch?: string; wait?: boolean }) { writeFileSync(configPath, JSON.stringify(response)); },
    calls() {
      return Parse(Calls, existsSync(callsPath) ? readFileSync(callsPath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line)) : []);
    },
    async waitUntilReady() {
      await new Promise<void>((resolve) => {
        const watcher = watch(root, () => {
          if (existsSync(readyPath)) { watcher.close(); resolve(); }
        });
        if (existsSync(readyPath)) { watcher.close(); resolve(); }
        t.after(() => watcher.close());
      });
    },
  };
}

test("registers only a deferred jj tool with native structured discovery metadata", async (t) => {
  const { definition } = await setup(t);
  assert.equal(definition.name, "jj");
  assert.equal(definition.exposure, "deferred");
  assert.equal(definition.namespace?.name, "jj");
  assert.equal(definition.annotations?.readOnlyHint, true);
  assert.equal(definition.annotations?.destructiveHint, false);
  assert.ok(Check(Type.Object({ type: Type.Literal("object") }), definition.parameters));
  assert.ok(definition.outputSchema);
});

test("operation-discriminated parameters admit only relevant variants and bounds", async (t) => {
  const { definition, root } = await setup(t);
  for (const request of [
    { operation: "status" }, { operation: "log", revset: "@", limit: 1, paths: ["a"] },
    { operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "files", limit: 2 },
    { operation: "diff", comparison: { kind: "range", from: "@-", to: "@" }, format: "patch", paths: ["a"] },
    { operation: "show", revision: "@" }, { operation: "file_show", revision: "@-", path: "a" },
    { operation: "bookmark_list", names: ["main"], revset: "@", limit: 3 },
  ]) assert.ok(Check(definition.parameters, { repository: root, request }));
  for (const input of [
    { request: { operation: "status" } },
    { repository: root, request: { operation: "new" } },
    { repository: root, request: { operation: "status", argv: ["new"] } },
    { repository: root, request: { operation: "show" } },
    { repository: root, request: { operation: "log", revset: "@", limit: 101 } },
    { repository: root, max_bytes: 50_001, request: { operation: "status" } },
    { repository: root, request: { operation: "file_show", revision: "@", path: "a\u0000b" } },
    { repository: root, request: { operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "patch", limit: 2 } },
    { repository: root, request: { operation: "diff", comparison: { kind: "range", from: "@" }, format: "patch" } },
    { repository: root, request: { operation: "diff", comparison: { kind: "revisions", revset: "@", from: "@" }, format: "patch" } },
  ]) assert.equal(Check(definition.parameters, input), false, JSON.stringify(input));
});

test("status returns exact structured revision, parent, conflict, file and bookmark data", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  const result = await harness.call({ operation: "status" });
  assert.equal(result.isError, false);
  const output = Parse(Type.Object({ ok: Type.Literal(true), operation: Type.Literal("status"), status: Type.Object({ revision: Type.Object({ commit_id: Type.String() }) }), complete: Type.Boolean(), commands: Diagnostics }), result.structuredContent);
  assert.equal(output.status.revision.commit_id, commit.commit_id);
  assert.partialDeepStrictEqual(result.structuredContent, { status: revision, complete: true });
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(result.structuredContent) }]);
  assert.equal(output.commands[0]?.exit_code, 0);
  assert.deepEqual(harness.calls()[0]?.args.slice(0, 3), [`--repository=${harness.root}`, "--no-pager", "--color=never"]);
});

test("literal paths and revision expressions travel in argv without option or shell injection", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  const malicious = '-r @; touch "not-created"\n$(new) | --config=x';
  const literalPath = '-file:[a]* "x"\n\b\f\u001b; $(touch pwned)';
  harness.respond({ stdout: ndjson([revision]) });
  await harness.call({ operation: "log", revset: malicious, paths: [literalPath] });
  harness.respond({ stdout: "body" });
  await harness.call({ operation: "file_show", revision: malicious, path: literalPath });
  const calls = harness.calls();
  assert.ok(calls[0]?.args.includes("--revisions=" + malicious));
  assert.equal(calls[0]?.args.at(-1), 'root:"' + literalPath.replaceAll('"', '\\"') + '"');
  assert.ok(calls[1]?.args.includes("--revision=" + malicious));
  assert.equal(calls[1]?.args.at(-1), 'root-file:"' + literalPath.replaceAll('"', '\\"') + '"');
  assert.equal(existsSync(join(harness.root, "pwned")), false);
  assert.equal(calls[0]?.cwd, harness.root);
});

test("show pins its bounded patch to the full resolved commit ID", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  harness.respond({ stdout: ndjson([revision]), patch: "diff --git a/a b/a\n+text\n", stderr: "warning\n" });
  const result = await harness.call({ operation: "show", revision: "@" });
  assert.partialDeepStrictEqual(result.structuredContent, { ok: true, operation: "show", revision, patch: { text: "diff --git a/a b/a\n+text\n", complete: true } });
  const calls = harness.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.args.slice(3), ["diff", "--git", "--revisions=" + commit.commit_id]);
  harness.respond({ stdout: ndjson([revision, revision]) });
  const ambiguous = Parse(ErrorOutput, (await harness.call({ operation: "show", revision: "@ | @-" })).structuredContent);
  assert.equal(ambiguous.error.kind, "invalid_request");
  assert.equal(harness.calls().length, 3);
  harness.respond({ stdout: "" });
  assert.equal(Parse(ErrorOutput, (await harness.call({ operation: "show", revision: "none()" })).structuredContent).error.kind, "invalid_request");
});

test("diff exposes explicit revision/range comparisons and machine files or bounded patch", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  harness.respond({ stdout: ndjson([changedFile]) });
  const files = await harness.call({ operation: "diff", comparison: { kind: "range", from: "@-", to: "@" }, format: "files", paths: ["a*"] });
  assert.partialDeepStrictEqual(files.structuredContent, { operation: "diff", format: "files", files: [changedFile], complete: true });
  assert.ok(harness.calls()[0]?.args.includes("--from=@-"));
  assert.ok(harness.calls()[0]?.args.includes("--to=@"));
  harness.respond({ stdout: "patch contents" });
  const patch = await harness.call({ operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "patch" });
  assert.partialDeepStrictEqual(patch.structuredContent, { format: "patch", patch: { text: "patch contents" } });
  assert.ok(harness.calls()[1]?.args.includes("--git"));
});

test("bookmark list includes all remotes with literal name and revset transport", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  harness.respond({ stdout: ndjson([bookmark, { ...bookmark, remote: "origin" }]) });
  const result = await harness.call({ operation: "bookmark_list", names: ["a*[x]; new"], revset: "@ | @-" });
  assert.partialDeepStrictEqual(result.structuredContent, { bookmarks: [bookmark, { ...bookmark, remote: "origin" }], complete: true });
  const args = harness.calls()[0]?.args;
  assert.ok(args?.includes("--all-remotes"));
  assert.ok(args?.includes("--revision=@ | @-"));
  assert.equal(args?.at(-1), "exact:a*[x]; new");
});

test("runtime rejects mutating operations, extra argv and relative repositories without spawning", async (t) => {
  const harness = await setup(t);
  for (const request of [{ operation: "new" }, { operation: "git_push" }, { operation: "status", args: ["--config", "x"] }]) {
    const result = await harness.call(request);
    assert.equal(result.isError, true);
    assert.equal(Parse(ErrorOutput, result.structuredContent).error.kind, "invalid_request");
  }
  const relative = await harness.call({ operation: "status" }, undefined, undefined, ".");
  assert.equal(Parse(ErrorOutput, relative.structuredContent).error.kind, "invalid_request");
  assert.deepEqual(harness.calls(), []);
});

test("subprocess failures preserve actual exit, stderr and partial stdout as structured errors", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  harness.respond({ code: 7, stdout: "partial stdout", stderr: "invalid revset\n" });
  const result = await harness.call({ operation: "log", revset: "bad" });
  assert.equal(result.isError, true);
  const output = Parse(ErrorOutput, result.structuredContent);
  assert.equal(output.error.kind, "exit");
  assert.equal(output.commands[0]?.exit_code, 7);
  assert.equal(output.commands[0]?.stderr.text, "invalid revset\n");
  assert.equal(output.stdout.text, "partial stdout");
  harness.respond({ stdout: '{"not":"revision"}\n' });
  assert.equal(Parse(ErrorOutput, (await harness.call({ operation: "status" })).structuredContent).error.kind, "invalid_output");
  harness.respond({ stdout: "not json\n" });
  assert.equal(Parse(ErrorOutput, (await harness.call({ operation: "bookmark_list" })).structuredContent).error.kind, "invalid_output");
});

test("missing jj is a structured spawn failure, not an invented exit code", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  rmSync(join(harness.bin, "jj"));
  process.env.PATH = harness.bin;
  const result = await harness.call({ operation: "status" });
  const output = Parse(ErrorOutput, result.structuredContent);
  assert.equal(output.error.kind, "spawn");
  assert.equal(output.commands[0]?.exit_code, -2);
  assert.equal(output.stdout.complete, false);
});

test("byte and record bounds truthfully mark incomplete output without losing complete records", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  harness.respond({ stdout: "abcdef😀xyz", stderr: "w".repeat(10_000) });
  const body = await harness.call({ operation: "file_show", revision: "@", path: "a" }, 8);
  assert.partialDeepStrictEqual(body.structuredContent, { ok: true, complete: false, body: { text: "abcdef", bytes_observed: 13, truncated: true, complete: false }, commands: [{ stderr: { bytes_observed: 10_000, truncated: true, complete: false } }] });
  harness.respond({ stdout: ndjson([revision, revision]) });
  const log = await harness.call({ operation: "log", revset: "all()", limit: 1 });
  assert.partialDeepStrictEqual(log.structuredContent, { revisions: [revision], complete: false });
  assert.ok(harness.calls()[1]?.args.includes("--limit=2"));
  const bytes = Buffer.byteLength(ndjson([revision]));
  const partial = await harness.call({ operation: "log", revset: "all()" }, bytes + 10);
  assert.partialDeepStrictEqual(partial.structuredContent, { revisions: [revision], complete: false });
  const status = await harness.call({ operation: "status" }, 10);
  assert.equal(Parse(ErrorOutput, status.structuredContent).error.kind, "output_limit");
  harness.respond({ stdout: ndjson([bookmark, bookmark]) });
  assert.partialDeepStrictEqual((await harness.call({ operation: "bookmark_list", limit: 1 })).structuredContent, { bookmarks: [bookmark], complete: false });
  harness.respond({ stdout: ndjson([changedFile, changedFile]) });
  assert.partialDeepStrictEqual((await harness.call({ operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "files", limit: 1 })).structuredContent, { files: [changedFile], complete: false });
});

test("escaped model-facing JSON is bounded and recoverable without changing structured success or errors", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  const body = '"\\\n'.repeat(10_000);
  for (const code of [0, 7]) {
    harness.respond({ stdout: body, stderr: "diagnostic\n", code });
    const result = await harness.call({ operation: "file_show", revision: "@", path: "a" }, 50_000);
    const fullText = JSON.stringify(result.structuredContent);
    assert.ok(Buffer.byteLength(fullText) > DEFAULT_MAX_BYTES);
    const rendered = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    assert.ok(Buffer.byteLength(rendered) <= DEFAULT_MAX_BYTES);
    assert.ok(rendered.split("\n").length <= DEFAULT_MAX_LINES);
    const fullOutputPath = /Full result saved to: ([^\n]+)\]/.exec(rendered)?.[1];
    assert.ok(fullOutputPath);
    t.after(() => rmSync(dirname(fullOutputPath), { recursive: true, force: true }));
    assert.equal(readFileSync(fullOutputPath, "utf8"), fullText);
    assert.equal(result.isError, code !== 0);
    assert.partialDeepStrictEqual(result.structuredContent, code === 0
      ? { ok: true, complete: true, body: { text: body, truncated: false, complete: true } }
      : { ok: false, error: { kind: "exit" }, stdout: { text: body, truncated: false, complete: true } });
  }
});

test("cancellation prevents launch or terminates an active child and retains incomplete output", { skip: posixFixtures, timeout: 30000 }, async (t) => {
  const harness = await setup(t);
  const pre = new AbortController();
  pre.abort();
  const cancelled = Parse(ErrorOutput, (await harness.call({ operation: "status" }, undefined, pre.signal)).structuredContent);
  assert.equal(cancelled.error.kind, "cancelled");
  assert.equal(cancelled.commands[0]?.exit_code, null);
  assert.deepEqual(harness.calls(), []);
  harness.respond({ wait: true, stdout: "partial", stderr: "before abort" });
  const controller = new AbortController();
  const running = harness.call({ operation: "file_show", revision: "@", path: "a" }, undefined, controller.signal);
  await harness.waitUntilReady();
  controller.abort();
  const output = Parse(ErrorOutput, (await running).structuredContent);
  assert.equal(output.error.kind, "cancelled");
  assert.equal(output.commands[0]?.signal, "SIGTERM");
  assert.equal(output.stdout.text, "partial");
  assert.equal(output.commands[0]?.stderr.text, "before abort");
  assert.equal(output.stdout.complete, false);
});

test("native codemode discovers jj and receives structured success and error values", { skip: posixFixtures }, async (t) => {
  const harness = await setup(t);
  const codemodePath = fileURLToPath(new URL("./extensions/codemode/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  const loaded = await discoverAndLoadExtensions([codemodePath], harness.root, harness.root);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getAllTools = () => [{ ...harness.definition, exposure: "deferred", sourceInfo: harness.sourceInfo }];
  const codemode = loaded.extensions[0]?.tools.get("codemode")?.definition;
  assert.ok(codemode);
  const CallInput = Type.Object({ repository: Type.String(), request: Type.Object({ operation: Type.String() }) });
  const context: ExtensionToolContext = {
    ...harness.runner.createContext(), tools: [harness.tool],
    async executeTool(name: string, args: unknown, options?: ExecuteToolOptions) {
      assert.equal(name, "jj");
      assert.ok(Check(harness.definition.parameters, args));
      assert.ok(Check(CallInput, args));
      if (args.request.operation === "log") harness.respond({ code: 7, stdout: "partial", stderr: "invalid revset\n" });
      const result = await harness.tool.execute("script/jj", args, options?.signal);
      return { toolCall: { type: "toolCall", id: "script/jj", name, arguments: args }, result, isError: result.isError ?? false };
    },
  };
  const code = `
const found = await searchTools("Jujutsu repository inspection", {limit: 1});
const namespace = await describeNamespace("jj");
const success = await tools.jj({repository: ${JSON.stringify(harness.root)}, request: {operation: "status"}});
const failure = await tools.jj({repository: ${JSON.stringify(harness.root)}, request: {operation: "log", revset: "bad"}});
text({name: found[0].name, namespace: namespace.name, instructions: typeof namespace.instructions === "string" && namespace.instructions.length > 0, successType: typeof success, success: success.ok,
commit: success.status.revision.commit_id, failureType: typeof failure,
failure: failure.ok, kind: failure.error.kind});`;
  const result = await codemode.execute("script", { code }, undefined, undefined, context);
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const output = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  assert.match(output, /"name":"jj","namespace":"jj","instructions":true/);
  assert.match(output, /"successType":"object","success":true/);
  assert.match(output, /"failureType":"object","failure":false,"kind":"exit"/);
  assert.match(output, new RegExp(commit.commit_id));
});

test("ordinary jj snapshots newly edited disk content through registered inspections", async (t) => {
  const harness = await setup(t, false);
  const repository = join(harness.root, "repo");
  execFileSync("jj", ["git", "init", "--no-colocate", repository], { cwd: harness.root, stdio: "pipe" });
  const file = join(repository, "edited.txt");
  const Current = Type.Object({ status: Type.Object({ revision: Type.Object({ commit_id: Type.String() }) }) });
  writeFileSync(file, "before\n");
  const before = Parse(Current, (await harness.call({ operation: "status" }, undefined, undefined, repository)).structuredContent);
  writeFileSync(file, "status disk edit\n");
  const status = await harness.call({ operation: "status" }, undefined, undefined, repository);
  assert.equal(status.isError, false, JSON.stringify(status));
  const current = Parse(Current, status.structuredContent);
  assert.notEqual(current.status.revision.commit_id, before.status.revision.commit_id);
  assert.partialDeepStrictEqual(status.structuredContent, { complete: true, status: { empty: false, changed_files: [{ path: "edited.txt", status: "added" }] } });

  writeFileSync(file, "log disk edit\n");
  const log = await harness.call({ operation: "log", revset: "@" }, undefined, undefined, repository);
  const revisions = Parse(Type.Object({ revisions: Type.Array(Type.Object({ revision: Type.Object({ commit_id: Type.String() }) })) }), log.structuredContent);
  const latest = revisions.revisions[0];
  assert.ok(latest);
  assert.notEqual(latest.revision.commit_id, current.status.revision.commit_id);

  writeFileSync(file, "diff disk edit\n");
  const diff = await harness.call({ operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "patch" }, undefined, undefined, repository);
  assert.ok(Parse(Type.Object({ patch: TextOutput }), diff.structuredContent).patch.text.includes("+diff disk edit\n"));
  writeFileSync(file, "show disk edit\n");
  const show = await harness.call({ operation: "show", revision: "@" }, undefined, undefined, repository);
  assert.ok(Parse(Type.Object({ patch: TextOutput }), show.structuredContent).patch.text.includes("+show disk edit\n"));
  writeFileSync(file, "file disk edit\n");
  const contents = await harness.call({ operation: "file_show", revision: "@", path: "edited.txt" }, undefined, undefined, repository);
  assert.equal(Parse(Type.Object({ body: TextOutput }), contents.structuredContent).body.text, "file disk edit\n");

  for (const request of [
    { operation: "log", revset: "@ | @-", limit: 2 },
    { operation: "log", revset: "@", paths: ['literal [x]* "quote"\n\b\f\u001b'] },
    { operation: "diff", comparison: { kind: "revisions", revset: "@" }, format: "files" },
    { operation: "diff", comparison: { kind: "range", from: "@-", to: "@" }, format: "patch" },
    { operation: "bookmark_list", names: ["main"] },
  ]) {
    const result = await harness.call(request, undefined, undefined, repository);
    assert.equal(result.isError, false, JSON.stringify(result));
  }
});
