import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const script = new URL("../scripts/sync-pi-deps.mjs", import.meta.url);

for (const binaryName of process.platform === "win32" ? ["pi.exe", "pi.cmd"] : ["pi"]) {
  test(`dependency sync finds ${binaryName} and ignores workspace binaries`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "pi dependency sync "));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, "extensions");
    const scripts = join(workspace, "scripts");
    const localBin = join(workspace, "node_modules", ".bin");
    const installedBin = join(root, "mise", "pi", "1.2.3");
    for (const directory of [scripts, localBin, installedBin]) {
      mkdirSync(directory, { recursive: true });
    }
    copyFileSync(script, join(scripts, "sync-pi-deps.mjs"));
    writeFileSync(join(localBin, binaryName), "");
    writeFileSync(join(installedBin, binaryName), "");
    const installedPackage = {
      name: "@earendil-works/pi-coding-agent",
      version: "1.2.3",
      dependencies: {
        "@earendil-works/pi-ai": "^1.2.4",
        "@earendil-works/pi-tui": "~1.2.5",
        typebox: "^1.3.27",
      },
    };
    writeFileSync(join(installedBin, "package.json"), JSON.stringify(installedPackage));
    writeFileSync(join(localBin, "package.json"), JSON.stringify({ ...installedPackage, version: "9.9.9" }));
    const workspacePackage = {
      name: "extensions",
      devDependencies: { typescript: "^5.9.3" },
      peerDependencies: { typescript: "^5" },
    };
    writeFileSync(join(workspace, "package.json"), JSON.stringify(workspacePackage));

    const result = spawnSync(process.execPath, [join(scripts, "sync-pi-deps.mjs")], {
      env: { ...process.env, PATH: [localBin, installedBin].join(delimiter) },
      encoding: "utf8",
      timeout: 5000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")), {
      ...workspacePackage,
      peerDependencies: {
        ...workspacePackage.peerDependencies,
        "@earendil-works/pi-coding-agent": "*",
        "@earendil-works/pi-ai": "*",
        "@earendil-works/pi-tui": "*",
        typebox: "*",
      },
      devDependencies: {
        ...workspacePackage.devDependencies,
        "@earendil-works/pi-coding-agent": "1.2.3",
        "@earendil-works/pi-ai": "1.2.4",
        "@earendil-works/pi-tui": "1.2.5",
        typebox: "1.3.27",
      },
    });
  });
}
