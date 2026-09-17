import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const bootstrap = new URL("../editor-env.ts", import.meta.url).href;
const editorState = new URL("../shared/editor-state.ts", import.meta.url).href;

test("editor bootstrap and launcher preserve paths and exit codes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi editor ü "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "config");
  const bin = join(config, "nvim", "bin");
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, "pi-nvim-editor");
  const recorded = join(root, "arguments.json");
  writeFileSync(wrapper, `
    require("node:fs").writeFileSync(process.env.PI_EDITOR_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
    process.exit(Number(process.env.PI_EDITOR_EXIT));
  `);
  const target = join(root, "draft 'quoted' & spaced.md");
  const env = {
    ...process.env,
    HOME: process.platform === "win32" ? undefined : root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: config,
    NVIM_APPNAME: undefined,
    EDITOR: undefined,
    VISUAL: undefined,
    PI_EDITOR_ARGS_FILE: recorded,
  };
  for (const code of [0, 1, 2]) {
    const result = spawnSync("node", ["--input-type=module", "-e", `
      import initialize from ${JSON.stringify(bootstrap)};
      import { runEditor } from ${JSON.stringify(editorState)};
      initialize();
      console.log(await runEditor(${JSON.stringify(target)}, 3));
    `], { env: { ...env, PI_EDITOR_EXIT: String(code) }, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), String(code));
    assert.equal(readFileSync(recorded, "utf8"), JSON.stringify(["+3", target]));
  }
});

test("Windows finds the client under LOCALAPPDATA without HOME", { skip: process.platform !== "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-editor-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "nvim", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pi-nvim-editor"), "");
  const result = spawnSync("node", ["--input-type=module", "-e", `
    import initialize from ${JSON.stringify(bootstrap)};
    initialize();
    console.log(process.env.EDITOR);
    console.log(process.env.VISUAL);
  `], {
    env: { ...process.env, HOME: undefined, XDG_CONFIG_HOME: undefined, LOCALAPPDATA: root, NVIM_APPNAME: undefined },
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const expected = `node ${join(bin, "pi-nvim-editor")}`;
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [expected, expected]);
});

test("devices without the RPC client retain their editor or default to nvim", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-editor-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const editor of [undefined, "nano"]) {
    const result = spawnSync("node", ["--input-type=module", "-e", `
      import initialize from ${JSON.stringify(bootstrap)};
      initialize();
      console.log(process.env.EDITOR);
      console.log(process.env.VISUAL);
    `], {
      env: {
        ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, LOCALAPPDATA: root,
        NVIM_APPNAME: undefined, EDITOR: editor, VISUAL: undefined,
      },
      encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), [editor ?? "nvim", editor ?? "nvim"]);
  }
});

test("missing editor reports launch failure", () => {
  const result = spawnSync("node", ["--input-type=module", "-e", `
    import { runEditor } from ${JSON.stringify(editorState)};
    console.log(await runEditor("draft.md", 1));
  `], {
    env: { ...process.env, EDITOR: "pi-test-nonexistent-editor" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "null");
});
