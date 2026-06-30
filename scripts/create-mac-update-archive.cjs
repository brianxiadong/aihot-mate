const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const pkg = require(path.join(root, "package.json"));

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app")) result.push(fullPath);
      else walk(fullPath, result);
    }
  }
  return result;
}

const apps = walk(releaseDir).filter((candidate) => path.basename(candidate) === `${pkg.build.productName}.app`);
if (apps.length === 0) {
  throw new Error("No macOS .app bundle found under release/.");
}

const appPath = apps[0];
const appParent = path.dirname(appPath);
const appName = path.basename(appPath);
const archiveName = `AIHOT.Mate-${pkg.version}-mac-universal.app.tar.gz`;
const archivePath = path.join(releaseDir, archiveName);

if (fs.existsSync(archivePath)) {
  fs.rmSync(archivePath, { force: true });
}

const result = spawnSync("/usr/bin/tar", ["-czf", archivePath, "-C", appParent, appName], {
  stdio: "inherit"
});
if (result.status !== 0) {
  throw new Error(`tar failed with exit code ${result.status}`);
}

console.log(`Created ${path.relative(root, archivePath)}`);
