import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const script = new URL("../scripts/sync-pi-deps.mjs", import.meta.url);

for (const binaryName of process.platform === "win32" ? ["pi.exe", "pi.cmd"] : ["pi"]) {
  for (const layout of process.platform === "win32" ? ["npm", "managed"] : ["npm", "managed", "managed-symlink"]) {
    test(`dependency sync finds ${binaryName} (${layout}) and ignores workspace binaries`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "pi dependency sync "));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const workspace = join(root, "extensions");
      const scripts = join(workspace, "scripts");
      const localBin = join(workspace, "node_modules", ".bin");
      const agentDir = join(root, "agent");
      const managedRoot = join(agentDir, "install");
      const installedBin = layout === "npm" ? join(root, "mise", "pi", "1.2.3") : join(agentDir, "bin");
      const installedPackageDir = layout === "npm" ? installedBin
        : join(managedRoot, "releases", "1.2.3", "node_modules", "@earendil-works", "pi-coding-agent");
      const pathBin = layout === "managed-symlink" ? join(root, ".local", "bin") : installedBin;
      for (const directory of [scripts, localBin, installedBin, installedPackageDir, pathBin]) {
        mkdirSync(directory, { recursive: true });
      }
      copyFileSync(script, join(scripts, "sync-pi-deps.mjs"));
      writeFileSync(join(localBin, binaryName), "");
      writeFileSync(join(installedBin, binaryName), layout === "npm" ? "" : "#!/bin/sh\n");
      if (layout !== "npm") {
        writeFileSync(join(managedRoot, "current-version"), "1.2.3\n");
      }
      if (layout === "managed-symlink") {
        symlinkSync(join(installedBin, binaryName), join(pathBin, binaryName));
      }
      const installedPackage = {
        name: "@earendil-works/pi-coding-agent",
        version: "1.2.3",
        dependencies: {
          "@earendil-works/pi-ai": "^1.2.4",
          "@earendil-works/pi-tui": "~1.2.5",
          typebox: "^1.3.27",
        },
      };
      writeFileSync(join(installedPackageDir, "package.json"), JSON.stringify(installedPackage));
      if (layout !== "npm") {
        const inactivePackageDir = join(managedRoot, "releases", "9.9.9", "node_modules", "@earendil-works", "pi-coding-agent");
        mkdirSync(inactivePackageDir, { recursive: true });
        writeFileSync(join(inactivePackageDir, "package.json"), JSON.stringify({ ...installedPackage, version: "9.9.9" }));
        writeFileSync(join(managedRoot, "releases", "1.2.3", "package.json"), JSON.stringify({
          name: "@earendil-works/pi-coding-agent-install", version: "1.2.3",
        }));
      }
      writeFileSync(join(localBin, "package.json"), JSON.stringify({ ...installedPackage, version: "9.9.9" }));
      const workspacePackage = {
        name: "extensions",
        devDependencies: { typescript: "^5.9.3" },
        peerDependencies: { typescript: "^5" },
      };
      writeFileSync(join(workspace, "package.json"), JSON.stringify(workspacePackage));

      const result = spawnSync(process.execPath, [join(scripts, "sync-pi-deps.mjs")], {
        env: { ...process.env, PI_MANAGED_INSTALL_ROOT: join(root, "unrelated-install"), PATH: [localBin, pathBin].join(delimiter) },
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
}

for (const version of ["../../outside", "4.5.6"]) {
  test(`dependency sync leaves dependencies unchanged for an invalid or missing managed release (${version})`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "pi dependency sync "));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, "extensions");
    const scripts = join(workspace, "scripts");
    const installedBin = join(root, "agent", "bin");
    const managedRoot = join(root, "agent", "install");
    for (const directory of [scripts, installedBin, managedRoot]) {
      mkdirSync(directory, { recursive: true });
    }
    copyFileSync(script, join(scripts, "sync-pi-deps.mjs"));
    writeFileSync(join(installedBin, process.platform === "win32" ? "pi.cmd" : "pi"), "");
    writeFileSync(join(managedRoot, "current-version"), `${version}\n`);
    const originalPackage = JSON.stringify({ name: "extensions", devDependencies: { typescript: "^5.9.3" } });
    writeFileSync(join(workspace, "package.json"), originalPackage);

    const result = spawnSync(process.execPath, [join(scripts, "sync-pi-deps.mjs")], {
      env: { ...process.env, PATH: installedBin },
      encoding: "utf8",
      timeout: 5000,
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, version === "4.5.6"
      ? /Could not find @earendil-works\/pi-coding-agent package.json/
      : /Managed Pi version file is invalid/);
    assert.equal(readFileSync(join(workspace, "package.json"), "utf8"), originalPackage);
  });
}
