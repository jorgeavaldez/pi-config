import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  getSelectListTheme,
  initTheme,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
  stripTerminalSequences,
  TuiMainScreen,
  type Component,
  type EditorComponent,
  type KeyId,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Value } from "typebox/value";

const recordingSchema = Type.Object({ args: Type.Array(Type.String()), file: Type.String(), content: Type.String() });

function readEditorRecording(filepath: string) {
  const recording: unknown = JSON.parse(readFileSync(filepath, "utf8"));
  assert.ok(Value.Check(recordingSchema, recording), "Invalid editor recording");
  return recording;
}

// Exercise the real hosted extension loader and UI components, with no terminal or model I/O.
async function setup(t: TestContext, extension: string, externalKeys: KeyId[] = ["ctrl+g"]) {
  const root = mkdtempSync(join(tmpdir(), "pi-editor-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL(`../${extension}.ts`, import.meta.url))],
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
  loaded.runtime.getThinkingLevel = () => "off";
  const session = SessionManager.inMemory(root);
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, session, new ModelRegistry(models));
  const tui = new TuiMainScreen({
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    columns: 120,
    rows: 40,
    kittyProtocolActive: false,
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  });
  const stop = t.mock.method(tui, "stop", () => {});
  const start = t.mock.method(tui, "start", () => {});
  t.mock.method(tui, "requestRender", () => {});
  const keys = new KeybindingsManager({ "app.editor.external": externalKeys });
  const state: {
    draft: string;
    editor: EditorComponent | undefined;
    dialog: (Component & { dispose?(): void }) | undefined;
    notifications: ("info" | "warning" | "error" | undefined)[];
    sent: Parameters<ExtensionAPI["sendUserMessage"]>[0][];
    widgetClears: number;
    widgets: number;
    onDialog: (component: Component) => void;
    select: (title: string, options: string[]) => Promise<string | undefined>;
    finished: ReturnType<typeof Promise.withResolvers<void>>;
  } = {
    draft: "existing draft",
    editor: undefined,
    dialog: undefined,
    notifications: [],
    sent: [],
    widgetClears: 0,
    widgets: 0,
    onDialog: (_component: Component) => {},
    select: async (_title: string, _options: string[]): Promise<string | undefined> => "Empty branch",
    finished: Promise.withResolvers<void>(),
  };
  loaded.runtime.sendUserMessage = (content) => {
    state.sent.push(content);
    state.finished.resolve();
  };
  const ui: ExtensionUIContext = {
    ...runner.getUIContext(),
    select: (title, options) => state.select(title, options),
    getEditorText: () => state.draft,
    setEditorText: (text) => {
      state.draft = text;
    },
    notify: (_message, severity) => {
      state.notifications.push(severity);
      state.finished.resolve();
    },
    setWidget: (_key, content) => {
      if (content === undefined) state.widgetClears++;
      else state.widgets++;
    },
    setEditorComponent: (factory) => {
      state.editor = factory?.(tui, { borderColor: (text) => text, selectList: getSelectListTheme() }, keys);
    },
    async custom(factory) {
      const completion = Promise.withResolvers<Parameters<Parameters<typeof factory>[3]>[0]>();
      const component = await factory(tui, ui.theme, keys, completion.resolve);
      state.dialog = component;
      state.onDialog(component);
      try {
        return await completion.promise;
      } finally {
        component.dispose?.();
        state.dialog = undefined;
      }
    },
  };
  runner.setUIContext(ui, "tui");
  t.after(() => state.dialog?.dispose?.());
  // A real child editor records its input and performs the requested edit before exiting.
  const record = join(root, "editor-input.json");
  const action = join(root, "editor-action.json");
  const editor = join(root, "nvim-editor.cjs");
  writeFileSync(
    editor,
    `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    const file = args.at(-1);
    let content = fs.readFileSync(file, "utf8");
    fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, file, content }));
    const action = JSON.parse(fs.readFileSync(${JSON.stringify(action)}, "utf8"));
    if (action.remove) fs.unlinkSync(file);
    else {
      if (action.prompt !== undefined) content = content.replace(/(<!-- PROMPT: [^>]+ -->)\\n[\\s\\S]*?(\\n<!-- \\/REFERENCE:)/, "$1\\n" + action.prompt + "$2");
      if (action.reference) content = content.replace("visible answer", "changed answer");
      if (action.malformed) content = content.replace("<!-- /REFERENCE:", "<!-- BROKEN:");
      if (action.buffer !== undefined) content = action.buffer;
      fs.writeFileSync(file, content);
    }
    process.exit(action.exit ?? 0);
  `,
  );
  const previousEditor = process.env.EDITOR;
  process.env.EDITOR = `node "${editor}"`;
  t.after(() => {
    if (previousEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = previousEditor;
  });
  writeFileSync(action, "{}");
  return { root, runner, session, tui, keys, ui, state, start, stop, record, action };
}

test("main external editor keeps reference and draft together and submits only the prompt", async (t) => {
  const h = await setup(t, "editor-open", ["ctrl+e"]);
  h.session.appendMessage({ role: "user", content: "earlier user", timestamp: 1 });
  h.session.appendMessage({
    role: "assistant",
    content: [
      { type: "text", text: "visible answer" },
      { type: "thinking", thinking: "hidden" },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    stopReason: "stop",
    timestamp: 2,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  h.session.appendMessage({ role: "system", content: "secret system", timestamp: 3 });
  h.session.appendMessage({
    role: "toolResult",
    content: [{ type: "text", text: "tool output" }],
    toolCallId: "x",
    toolName: "test",
    isError: false,
    timestamp: 4,
  });
  h.session.appendCustomMessageEntry("test", "hidden custom text", false);
  await h.runner.emit({ type: "session_start", reason: "startup" });
  assert.ok(h.state.editor);
  writeFileSync(h.action, JSON.stringify({ prompt: "  next prompt  " }));
  h.state.editor.handleInput("\x05");
  await h.state.finished.promise;
  const recorded = readEditorRecording(h.record);
  assert.match(recorded.content, /visible answer\n<!-- PROMPT:/);
  assert.match(recorded.content, /existing draft/);
  assert.doesNotMatch(recorded.content, /secret system|tool output|hidden/);
  assert.equal(recorded.args[0], "+4");
  assert.deepEqual(h.state.sent, ["next prompt"]);
  assert.equal(h.state.draft, "");
  assert.equal(existsSync(dirname(recorded.file)), false);
  assert.equal(h.stop.mock.callCount(), 1);
  assert.equal(h.start.mock.callCount(), 1);
});

test("main editor rejection branches preserve the draft and clean up", async (t) => {
  for (const [name, action, severity] of [
    ["cancel", { exit: 1 }, "warning"],
    ["failure", { exit: 2 }, "warning"],
    ["changed reference", { reference: true }, "error"],
    ["empty prompt", { prompt: "  " }, "info"],
    ["malformed markers", { malformed: true }, "info"],
    ["unreadable file", { remove: true }, "error"],
  ] as const) {
    await t.test(name, async (t) => {
      const h = await setup(t, "editor-open");
      h.session.appendMessage({ role: "user", content: "visible answer", timestamp: 1 });
      await h.runner.emit({ type: "session_start", reason: "startup" });
      writeFileSync(h.action, JSON.stringify(action));
      h.state.editor?.handleInput("\x07");
      await h.state.finished.promise;
      const recorded = readEditorRecording(h.record);
      assert.deepEqual(h.state.notifications, [severity]);
      assert.deepEqual(h.state.sent, []);
      assert.equal(h.state.draft, "existing draft");
      assert.equal(existsSync(dirname(recorded.file)), false);
      assert.equal(h.start.mock.callCount(), 1);
    });
  }
});

test("fresh sessions and hidden-only history have no reference; displayed custom text is eligible", async (t) => {
  for (const history of ["fresh", "hidden", "displayed"] as const) {
    await t.test(history, async (t) => {
      const h = await setup(t, "editor-open");
      if (history !== "fresh") {
        h.session.appendMessage({ role: "system", content: "system instructions", timestamp: 1 });
        h.session.appendCustomMessageEntry("test", "custom text", history === "displayed");
      }
      await h.runner.emit({ type: "session_start", reason: "startup" });
      h.state.editor?.handleInput("\x07");
      await h.state.finished.promise;
      const recorded = readEditorRecording(h.record);
      assert.doesNotMatch(recorded.content, /system instructions/);
      assert.equal(recorded.content.includes("custom text"), history === "displayed");
      assert.equal(recorded.content.includes("<!-- REFERENCE:"), history === "displayed");
      assert.equal(recorded.args[0], history === "displayed" ? "+4" : "+2");
      assert.deepEqual(h.state.sent, ["existing draft"]);
      assert.equal(existsSync(dirname(recorded.file)), false);
    });
  }
});

test("main editor respects disabled external actions and delegates ordinary input", async (t) => {
  const h = await setup(t, "editor-open", []);
  await h.runner.emit({ type: "session_start", reason: "startup" });
  assert.ok(h.state.editor);
  h.state.editor.handleInput("a");
  assert.equal(h.state.editor.getText(), "a");
  h.state.editor.handleInput("\x07");
  assert.equal(h.stop.mock.callCount(), 0);
  assert.equal(existsSync(h.record), false);
  assert.deepEqual(h.state.sent, []);
});

test("review dialog honors and displays external action rebinding and disabling", async (t) => {
  for (const binding of [["ctrl+e", "ctrl+x"], []] satisfies KeyId[][]) {
    await t.test(binding.length ? "rebound" : "disabled", async (t) => {
      const h = await setup(t, "review", binding);
      mkdirSync(join(h.root, ".jj"));
      writeFileSync(h.action, JSON.stringify({ buffer: "edited revset\n" }));
      const opened = Promise.withResolvers<Component>();
      h.state.onDialog = (component) => opened.resolve(component);
      const command = h.runner.getCommand("review");
      assert.ok(command);
      const invocation = command.handler("original revset", h.runner.createCommandContext());
      const dialog = await opened.promise;
      const rendered = stripTerminalSequences(dialog.render(120).join("\n"));
      assert.deepEqual(h.keys.getKeys("app.editor.external"), binding);
      for (const key of binding) assert.ok(rendered.includes(key));
      assert.doesNotMatch(rendered, /ctrl\+g/);
      dialog.handleInput?.("\x07");
      assert.equal(h.stop.mock.callCount(), 0, "old Ctrl+G must not launch the editor");
      if (binding.length) {
        const renderedAgain = Promise.withResolvers<void>();
        // Final requestRender occurs after the externally edited text is installed.
        t.mock.method(h.tui, "requestRender", () => renderedAgain.resolve());
        dialog.handleInput?.("\x05");
        await renderedAgain.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.match(dialog.render(120).join("\n"), /edited revset/);
        assert.equal(h.stop.mock.callCount(), 1);
        assert.equal(h.start.mock.callCount(), 1);
        const recorded = readEditorRecording(h.record);
        assert.equal(recorded.content, "original revset");
        assert.equal(existsSync(dirname(recorded.file)), false);
      }
      assert.deepEqual(h.state.sent, [], "external editing alone must not submit review");
      dialog.handleInput?.("\x1b");
      await invocation;
      assert.deepEqual(h.state.notifications, ["info"]);
      assert.deepEqual(h.state.sent, []);
      assert.equal(h.state.widgets, 0);
    });
  }
});

test("end-review cancellation awaits navigation and retains origin/widget for retry", async (t) => {
  const h = await setup(t, "review");
  mkdirSync(join(h.root, ".jj"));
  const origin = h.session.appendMessage({ role: "user", content: "original conversation", timestamp: 1 });
  h.state.onDialog = (component) => component.handleInput?.("\r");
  const destinations: string[] = [];
  let navigate: ExtensionCommandContext["navigateTree"] = async (target) => {
    destinations.push(target);
    return { cancelled: false };
  };
  let abort = () => {};
  const ctx: ExtensionCommandContext = {
    ...h.runner.createCommandContext(),
    navigateTree: (target, options) => navigate(target, options),
    abort: () => abort(),
  };
  const review = h.runner.getCommand("review");
  const end = h.runner.getCommand("end-review");
  assert.ok(review && end);
  await review.handler("@", ctx);
  assert.equal(h.state.widgets, 1);
  assert.equal(h.state.widgetClears, 0);
  h.state.draft = "retained review draft";
  h.state.onDialog = () => {};
  h.state.select = async () => "Summarize";
  const navigation = Promise.withResolvers<{ cancelled: boolean }>();
  const navigating = Promise.withResolvers<void>();
  let aborts = 0;
  abort = () => {
    aborts++;
  };
  navigate = async (target) => {
    destinations.push(target);
    navigating.resolve();
    return navigation.promise;
  };
  let settled = false;
  const ending = end.handler("", ctx).then(() => {
    settled = true;
  });
  await navigating.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.state.dialog?.handleInput?.("\x1b");
  assert.equal(aborts, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "Escape must not resolve before navigation cancellation settles");
  assert.equal(h.state.widgetClears, 0);
  navigation.resolve({ cancelled: true });
  await ending;
  assert.equal(h.state.widgetClears, 0);
  assert.equal(h.state.draft, "retained review draft");
  for (const summaryChoice of ["Summarize", "No summary"]) {
    h.state.select = async () => summaryChoice;
    navigate = async (target) => {
      destinations.push(target);
      return { cancelled: true };
    };
    await end.handler("", ctx);
    assert.equal(h.state.widgetClears, 0);
    assert.equal(h.state.draft, "retained review draft");
    assert.equal(destinations.at(-1), origin);
  }
  h.state.select = async () => "Summarize";
  for (const error of [new Error("summary unavailable"), new Error("")]) {
    navigate = async () => {
      throw error;
    };
    await end.handler("", ctx);
    assert.equal(h.state.widgetClears, 0);
    assert.equal(h.state.draft, "retained review draft");
    assert.equal(h.state.notifications.at(-1), "error");
  }
  navigate = async (target) => {
    destinations.push(target);
    return { cancelled: false };
  };
  h.state.draft = "";
  await end.handler("", ctx);
  assert.equal(h.state.widgetClears, 1);
  assert.ok(h.state.draft.trim());
  assert.ok(destinations.slice(1).every((target) => target === origin));
  const navigationCount = destinations.length;
  const returnedDraft = h.state.draft;
  await end.handler("", ctx);
  assert.equal(destinations.length, navigationCount);
  assert.equal(h.state.widgetClears, 1);
  assert.equal(h.state.draft, returnedDraft);
});
