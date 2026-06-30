const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { app, shell } = require("electron");
const { publicKeyPem } = require("./update-public-key.cjs");

const OWNER = "brianxiadong";
const REPO = "aihot-mate";
const APP_ID = "com.virxact.aihotmate";
const LATEST_MANIFEST_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.json`;
const LATEST_MANIFEST_SIG_URL = `${LATEST_MANIFEST_URL}.sig`;

let broadcast = () => undefined;
let activeManifest = null;
let activeAsset = null;
let downloadedAssetPath = null;

let updateState = {
  status: "idle",
  currentVersion: safeCurrentVersion(),
  latestVersion: null,
  releaseUrl: null,
  assetName: null,
  downloadedPath: null,
  progress: null,
  error: null
};

function safeCurrentVersion() {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

function setUpdateBroadcaster(nextBroadcast) {
  broadcast = typeof nextBroadcast === "function" ? nextBroadcast : () => undefined;
}

function getUpdateState() {
  return { ...updateState };
}

function setUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: safeCurrentVersion()
  };
  broadcast(getUpdateState());
  return getUpdateState();
}

function normalizeVersion(version) {
  return String(version || "0.0.0").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function platformAssetKeys() {
  if (process.platform === "darwin") {
    return ["darwin-universal", `darwin-${process.arch}`];
  }
  if (process.platform === "win32") {
    return [`win32-${process.arch}`, "win32-x64"];
  }
  return [`${process.platform}-${process.arch}`];
}

function selectPlatformAsset(manifest) {
  for (const key of platformAssetKeys()) {
    if (manifest.assets?.[key]) {
      return manifest.assets[key];
    }
  }
  return null;
}

function manifestUrl() {
  return process.env.AIHOT_UPDATE_MANIFEST_URL || LATEST_MANIFEST_URL;
}

function manifestSignatureUrl() {
  return process.env.AIHOT_UPDATE_MANIFEST_SIG_URL || `${manifestUrl()}.sig` || LATEST_MANIFEST_SIG_URL;
}

function isFileUrl(value) {
  return /^file:\/\//i.test(String(value || ""));
}

function filePathFromUrl(value) {
  return decodeURIComponent(new URL(value).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
}

async function readTextFromUrl(url) {
  if (isFileUrl(url)) {
    return fsp.readFile(filePathFromUrl(url), "utf8");
  }
  const response = await fetch(url, { headers: { "User-Agent": "aihot-mate-updater" } });
  if (!response.ok) {
    throw new Error(`Update request failed with HTTP ${response.status}.`);
  }
  return response.text();
}

async function downloadToFile(url, targetPath, onProgress) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  if (isFileUrl(url)) {
    const sourcePath = filePathFromUrl(url);
    const stat = await fsp.stat(sourcePath);
    let transferred = 0;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        transferred += chunk.length;
        onProgress?.(transferred, stat.size);
        callback(null, chunk);
      }
    });
    await pipeline(fs.createReadStream(sourcePath), progress, fs.createWriteStream(targetPath));
    return;
  }

  const response = await fetch(url, { headers: { "User-Agent": "aihot-mate-updater" } });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed with HTTP ${response.status}.`);
  }
  const total = Number(response.headers.get("content-length") || 0) || null;
  let transferred = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      transferred += chunk.length;
      onProgress?.(transferred, total);
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(targetPath));
}

function publicKey() {
  if (!publicKeyPem) {
    throw new Error("Update public key is not configured.");
  }
  return crypto.createPublicKey(publicKeyPem);
}

function verifyMessage(message, signatureBase64) {
  const signature = Buffer.from(String(signatureBase64 || ""), "base64");
  if (!signature.length) return false;
  return crypto.verify(null, message, publicKey(), signature);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest();
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error("Update manifest has an unsupported schema.");
  }
  if (manifest.appId !== APP_ID) {
    throw new Error("Update manifest is for a different app.");
  }
  if (!manifest.version || !manifest.assets) {
    throw new Error("Update manifest is incomplete.");
  }
}

async function checkForUpdates(options = {}) {
  try {
    setUpdateState({ status: "checking", progress: null, error: null });
    const manifestText = await readTextFromUrl(manifestUrl());
    const manifestSig = (await readTextFromUrl(manifestSignatureUrl())).trim();
    if (!verifyMessage(Buffer.from(manifestText, "utf8"), manifestSig)) {
      throw new Error("Update manifest signature is invalid.");
    }

    const manifest = JSON.parse(manifestText);
    validateManifest(manifest);
    const asset = selectPlatformAsset(manifest);
    if (!asset) {
      throw new Error("No update asset is available for this platform.");
    }

    activeManifest = manifest;
    activeAsset = asset;
    downloadedAssetPath = null;

    const latestVersion = normalizeVersion(manifest.version);
    if (compareVersions(latestVersion, safeCurrentVersion()) <= 0) {
      return setUpdateState({
        status: "current",
        latestVersion,
        releaseUrl: manifest.releaseUrl || null,
        assetName: asset.fileName || null,
        downloadedPath: null,
        progress: null,
        error: null
      });
    }

    const nextState = setUpdateState({
      status: "available",
      latestVersion,
      releaseUrl: manifest.releaseUrl || null,
      assetName: asset.fileName || null,
      downloadedPath: null,
      progress: null,
      error: null
    });

    if (options.autoDownload) {
      return downloadUpdate();
    }
    return nextState;
  } catch (error) {
    if (options.silent) {
      return setUpdateState({ status: "idle", progress: null, error: error.message || String(error) });
    }
    return setUpdateState({ status: "error", progress: null, error: error.message || String(error) });
  }
}

function updateDirectory(version) {
  return path.join(app.getPath("userData"), "updates", normalizeVersion(version));
}

async function downloadUpdate() {
  try {
    if (!activeManifest || !activeAsset) {
      await checkForUpdates();
    }
    if (!activeManifest || !activeAsset || updateState.status === "current") {
      return getUpdateState();
    }

    const fileName = activeAsset.fileName || path.basename(new URL(activeAsset.url).pathname);
    const targetPath = path.join(updateDirectory(activeManifest.version), fileName);
    setUpdateState({
      status: "downloading",
      assetName: fileName,
      downloadedPath: null,
      progress: { transferred: 0, total: activeAsset.size || null, percent: 0 },
      error: null
    });

    await downloadToFile(activeAsset.url, targetPath, (transferred, total) => {
      const percent = total ? Math.round((transferred / total) * 100) : null;
      setUpdateState({ progress: { transferred, total, percent } });
    });

    const digest = await sha256File(targetPath);
    const digestHex = digest.toString("hex");
    if (digestHex !== activeAsset.sha256) {
      await fsp.rm(targetPath, { force: true });
      throw new Error("Downloaded update hash does not match the manifest.");
    }
    if (!verifyMessage(digest, activeAsset.signature)) {
      await fsp.rm(targetPath, { force: true });
      throw new Error("Downloaded update signature is invalid.");
    }

    downloadedAssetPath = targetPath;
    return setUpdateState({
      status: "downloaded",
      downloadedPath: targetPath,
      progress: { transferred: activeAsset.size || null, total: activeAsset.size || null, percent: 100 },
      error: null
    });
  } catch (error) {
    return setUpdateState({ status: "error", progress: null, error: error.message || String(error) });
  }
}

function currentMacAppPath() {
  if (process.env.AIHOT_TEST_APP_PATH) {
    return process.env.AIHOT_TEST_APP_PATH;
  }
  const execPath = process.execPath;
  const appIndex = execPath.indexOf(".app/");
  if (appIndex < 0) {
    throw new Error("The current macOS app bundle path could not be detected.");
  }
  return execPath.slice(0, appIndex + 4);
}

async function writeMacInstallScript() {
  const script = `#!/bin/bash
set -euo pipefail
APP_PATH="$1"
ARCHIVE_PATH="$2"
LOG_PATH="$3"
APP_DIR="$(dirname "$APP_PATH")"
APP_NAME="$(basename "$APP_PATH")"
TMP_DIR="$(mktemp -d)"
{
  echo "Installing update for $APP_PATH"
  /usr/bin/tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
  NEW_APP="$(/usr/bin/find "$TMP_DIR" -maxdepth 1 -name "*.app" -type d | /usr/bin/head -n 1)"
  if [ -z "$NEW_APP" ]; then
    echo "No .app bundle found in update archive."
    exit 1
  fi
  for _ in $(seq 1 80); do
    if ! /usr/bin/pgrep -x "AIHOT Mate" >/dev/null 2>&1; then
      break
    fi
    /bin/sleep 0.25
  done
  BACKUP_PATH="$APP_DIR/$APP_NAME.previous-update"
  /bin/rm -rf "$BACKUP_PATH"
  if [ -d "$APP_PATH" ]; then
    /bin/mv "$APP_PATH" "$BACKUP_PATH"
  fi
  /bin/mv "$NEW_APP" "$APP_DIR/$APP_NAME"
  /usr/bin/xattr -dr com.apple.quarantine "$APP_DIR/$APP_NAME" >/dev/null 2>&1 || true
  /usr/bin/open "$APP_DIR/$APP_NAME"
  /bin/rm -rf "$TMP_DIR" "$BACKUP_PATH"
  echo "Update installed."
} >> "$LOG_PATH" 2>&1
`;
  const scriptPath = path.join(os.tmpdir(), `aihot-mate-install-update-${Date.now()}.sh`);
  await fsp.writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

async function installUpdate() {
  if (!downloadedAssetPath && updateState.status !== "downloaded") {
    await downloadUpdate();
  }
  if (!downloadedAssetPath) {
    throw new Error("No verified update has been downloaded.");
  }

  if (process.platform === "darwin") {
    if (!app.isPackaged && !process.env.AIHOT_TEST_APP_PATH) {
      throw new Error("macOS update installation is only available in packaged builds.");
    }
    setUpdateState({ status: "installing", error: null });
    const appPath = currentMacAppPath();
    const logPath = path.join(app.getPath("userData"), "update-install.log");
    const scriptPath = await writeMacInstallScript();
    const child = spawn("/bin/bash", [scriptPath, appPath, downloadedAssetPath, logPath], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    app.quit();
    return getUpdateState();
  }

  if (process.platform === "win32") {
    setUpdateState({ status: "installing", error: null });
    await shell.openPath(downloadedAssetPath);
    return getUpdateState();
  }

  throw new Error("Automatic installation is not supported on this platform.");
}

async function openUpdateReleasePage() {
  const target = updateState.releaseUrl || activeManifest?.releaseUrl || `https://github.com/${OWNER}/${REPO}/releases/latest`;
  await shell.openExternal(target);
  return true;
}

module.exports = {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  openUpdateReleasePage,
  setUpdateBroadcaster
};
