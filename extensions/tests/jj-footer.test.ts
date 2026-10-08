import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { Model, Usage } from "@earendil-works/pi-ai";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  initTheme,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ContextUsage,
  type ExtensionContext,
  type ExtensionUIContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, TuiMainScreen, type Component } from "@earendil-works/pi-tui";

const model: Model<"anthropic-messages"> = {
  id: "claude-sonnet-4-5",
  name: "Sonnet",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  input: ["text"],
  reasoning: true,
  contextWindow: 200000,
  maxTokens: 10000,
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
};

const usage: Usage = {
  input: 100,
  output: 10,
  cacheRead: 200,
  cacheWrite: 100,
  totalTokens: 410,
  cost: { input: 0.1, output: 0.1, cacheRead: 0.05, cacheWrite: 0.05, total: 0.3 },
};

async function setup(t: TestContext, jj = false) {
  const root = mkdtempSync(join(tmpdir(), "pi-footer-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (jj) {
    mkdirSync(join(root, ".jj"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "jj"),
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify("abcdefgh\u001ffeature\u001f\u001fcurrent change\u001ffalse\n12345678\u001fmain\u001forigin-main\u001fanchor\u001ftrue\n")});\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    t.after(() => {
      process.env.PATH = previousPath;
    });
  }
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL("../jj-footer.ts", import.meta.url))],
    root,
    root,
  );
  assert.deepEqual(loaded.errors, []);
  const models = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  initTheme("dark", false);
  loaded.runtime.getThinkingLevel = () => "high";
  const session = SessionManager.create(root, join(root, "sessions"));
  const state: {
    session: SessionManager;
    model: ExtensionContext["model"];
    contextUsage: ContextUsage | undefined;
    footer: (Component & { dispose?(): void }) | undefined;
  } = { session, model, contextUsage: { tokens: 2000, contextWindow: 200000, percent: 1 }, footer: undefined };
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, session, new ModelRegistry(models));
  const originalContext = runner.createContext();
  let contextCalls = 0;
  const rendered = Promise.withResolvers<void>();
  const tui = new TuiMainScreen({
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    columns: 200,
    rows: 40,
    kittyProtocolActive: false,
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgramStatus() {},
    setProgress() {},
  });
  t.mock.method(tui, "requestRender", () => rendered.resolve());
  let watcherDisposals = 0;
  const footerData: ReadonlyFooterDataProvider = {
    getGitBranch: () => "fallback",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () =>
      new Map([
        ["z", "last\nstatus"],
        ["a", "first\tstatus"],
      ]),
    onBranchChange: () => () => {
      watcherDisposals++;
    },
  };
  const ui: ExtensionUIContext = {
    ...runner.getUIContext(),
    setFooter: (factory) => {
      state.footer?.dispose?.();
      state.footer = factory?.(tui, ui.theme, footerData);
    },
  };
  runner.setUIContext(ui, "tui");
  t.mock.method(runner, "createContext", () => ({
    ...originalContext,
    ui,
    mode: "tui",
    get sessionManager() {
      return state.session;
    },
    get model() {
      return state.model;
    },
    getContextUsage: () => {
      contextCalls++;
      return state.contextUsage;
    },
  }));
  t.mock.method(SettingsManager, "create", () => SettingsManager.inMemory());
  const errors: string[] = [];
  runner.onError((error) => errors.push(error.error));
  t.after(async () => {
    await runner.emit({ type: "session_shutdown", reason: "quit" });
    assert.deepEqual(errors, []);
    assert.ok(watcherDisposals > 0);
  });
  await runner.emit({ type: "session_start", reason: "new" });
  return {
    runner,
    state,
    rendered,
    get contextCalls() {
      return contextCalls;
    },
  };
}

function render(h: Awaited<ReturnType<typeof setup>>, width = 200) {
  assert.ok(h.state.footer);
  const [header, stats, ...statuses] = h.state.footer.render(width).map(stripTerminalSequences);
  assert.ok(typeof header === "string" && typeof stats === "string");
  return { header, stats, statuses };
}

test("footer bills every usage entry and caches totals/context across unchanged renders", async (t) => {
  const h = await setup(t);
  const session = h.state.session;
  session.appendMessage({ role: "user", content: "history", timestamp: 1 });
  session.appendMessage({
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage,
    stopReason: "stop",
    timestamp: 2,
  });
  session.appendMessage({
    role: "toolResult",
    toolCallId: "call",
    toolName: "nested",
    content: [],
    isError: false,
    usage,
    timestamp: 3,
  });
  session.appendMessage({
    role: "toolResult",
    toolCallId: "no-usage",
    toolName: "read",
    content: [],
    isError: false,
    timestamp: 4,
  });
  session.appendCompaction("summary", session.getLeafId(), 100, undefined, false, usage);
  session.branchWithSummary(session.getLeafId(), "branch summary", undefined, false, usage);
  const standalone = session.appendUsage("unknown-future-kind", "anthropic", "test", usage);
  let usageReads = 0;
  Object.defineProperty(standalone, "usage", {
    get() {
      usageReads++;
      return usage;
    },
  });

  const lines = render(h);
  assert.match(lines.header, /\(fallback\)/);
  assert.match(lines.stats, /↑500 ↓50 R1\.0k W500 CH50\.0% \$1\.500 1\.0%\/200k \(auto\)/);
  assert.match(lines.stats, /\(anthropic\) claude-sonnet-4-5 • high/);
  assert.deepEqual(lines.statuses, ["first status last status"]);
  assert.equal(h.contextCalls, 1);
  assert.equal(usageReads, 1);
  render(h);
  render(h, 45);
  h.state.footer?.invalidate();
  render(h);
  assert.equal(h.contextCalls, 1);
  assert.equal(usageReads, 1);

  // Count changes even when navigation restores the same leaf.
  const oldLeaf = session.getLeafId();
  session.appendUsage("cache_warm", "anthropic", "test", usage);
  assert.ok(oldLeaf);
  session.branch(oldLeaf);
  assert.match(render(h).stats, /↑600 ↓60 R1\.2k W600 CH50\.0% \$1\.800/);
  assert.equal(h.contextCalls, 2);
  assert.equal(usageReads, 2);

  // Branch-only navigation changes context, not full-session billing.
  h.state.contextUsage = { tokens: null, contextWindow: 200000, percent: null };
  session.resetLeaf();
  assert.match(render(h).stats, /\$1\.800 \?\/200k/);
  assert.equal(h.contextCalls, 3);

  h.state.model = { ...model, contextWindow: 100000 };
  h.state.contextUsage = { tokens: 75000, contextWindow: 100000, percent: 75 };
  assert.match(render(h).stats, /75\.0%\/100k/);
  assert.equal(h.contextCalls, 4);

  // The manager can keep its identity across a session switch.
  const originalId = session.getSessionId();
  const idMock = t.mock.method(session, "getSessionId", () => "replacement-session");
  render(h);
  assert.equal(h.contextCalls, 5);
  idMock.mock.restore();
  render(h);
  assert.equal(h.contextCalls, 6);
  assert.equal(session.getSessionId(), originalId);

  // Same persisted id, leaf, count and model, but a different manager instance.
  const file = session.getSessionFile();
  assert.ok(file);
  const replacement = SessionManager.open(file);
  replacement.resetLeaf();
  h.state.session = replacement;
  assert.match(render(h).stats, /\$1\.800/);
  assert.equal(h.contextCalls, 7);
  render(h);
  assert.equal(h.contextCalls, 7);

  // Real compaction append invalidates unknown context, then the next assistant resets CH.
  replacement.appendCompaction("new summary", null, 100, undefined, false, usage);
  h.state.contextUsage = { tokens: null, contextWindow: 100000, percent: null };
  assert.match(render(h).stats, /\$2\.100 \?\/100k/);
  replacement.appendMessage({
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { ...usage, input: 0, cacheRead: 0, cacheWrite: 0 },
    stopReason: "stop",
    timestamp: 5,
  });
  h.state.contextUsage = { tokens: 5000, contextWindow: 100000, percent: 5 };
  assert.doesNotMatch(render(h).stats, /CH/);
  assert.equal(h.contextCalls, 9);
});

test(
  "JJ display survives usage caching; toggle disposes the footer and reinstalls it",
  { skip: process.platform === "win32" },
  async (t) => {
    const h = await setup(t, true);
    await h.rendered.promise;
    assert.match(render(h).header, /@: \(abcdefgh feature: current change\)\* \(main~1\)/);
    const command = h.runner.getCommand("jj-footer");
    assert.ok(command);
    await command.handler("off", h.runner.createCommandContext());
    assert.equal(h.state.footer, undefined);
    await command.handler("on", h.runner.createCommandContext());
    assert.ok(h.state.footer);
    assert.match(render(h).header, /@: \(abcdefgh feature: current change\)\* \(main~1\)/);
    assert.equal(h.contextCalls, 2);
  },
);
