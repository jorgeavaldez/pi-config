import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(workspaceDir, "package.json");

function stripVersion(range) {
  const match = String(range ?? "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) {
    throw new Error(`Could not extract version from range: ${range}`);
  }
  return match[0];
}

function findPiBinary() {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  const workspaceNodeModules = path.join(workspaceDir, "node_modules") + path.sep;
  let fallback = null;

  for (const entry of pathEntries) {
    const candidate = path.join(entry, process.platform === "win32" ? "pi.cmd" : "pi");
    if (!fs.existsSync(candidate)) continue;

    let resolved;
    try {
      resolved = fs.realpathSync(candidate);
    } catch {
      continue;
    }

    if (!fallback) {
      fallback = candidate;
    }

    if (resolved.startsWith(workspaceNodeModules)) {
      continue;
    }

    return candidate;
  }

  if (fallback) {
    return fallback;
  }

  throw new Error("Could not find 'pi' on PATH");
}

function getInstalledPiInfo() {
  const piBin = findPiBinary();
  const piCliPath = fs.realpathSync(piBin);
  let currentDir = path.dirname(piCliPath);

  while (true) {
    const piPackageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(piPackageJsonPath)) {
      const piPackageJson = JSON.parse(fs.readFileSync(piPackageJsonPath, "utf8"));
      if (piPackageJson.name === "@earendil-works/pi-coding-agent") {
        return { piPackageJson };
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error(`Could not find @earendil-works/pi-coding-agent package.json for ${piCliPath}`);
}

const workspacePackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const { piPackageJson: installedPiPackageJson } = getInstalledPiInfo();

const pinnedVersions = {
  "@earendil-works/pi-coding-agent": stripVersion(installedPiPackageJson.version),
  "@earendil-works/pi-agent-core": stripVersion(installedPiPackageJson.dependencies["@earendil-works/pi-agent-core"]),
  "@earendil-works/pi-ai": stripVersion(installedPiPackageJson.dependencies["@earendil-works/pi-ai"]),
  "@earendil-works/pi-tui": stripVersion(installedPiPackageJson.dependencies["@earendil-works/pi-tui"]),
  "typebox": stripVersion(installedPiPackageJson.dependencies.typebox),
};

workspacePackageJson.peerDependencies ??= {};
workspacePackageJson.devDependencies ??= {};

for (const [pkg, version] of Object.entries(pinnedVersions)) {
  workspacePackageJson.peerDependencies[pkg] = "*";
  workspacePackageJson.devDependencies[pkg] = version;
}

fs.writeFileSync(packageJsonPath, `${JSON.stringify(workspacePackageJson, null, 2)}\n`);
console.log(`Synced pi extension deps to ${pinnedVersions["@earendil-works/pi-coding-agent"]}`);
