const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalizeVersion(version) {
  return String(version || pkg.version).replace(/^v/i, "");
}

function releaseTag(version) {
  return `v${normalizeVersion(version)}`;
}

function releaseBaseUrl(repo, tag) {
  return `https://github.com/${repo}/releases/download/${tag}`;
}

function findFiles(dir, predicate, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(fullPath, predicate, result);
    else if (predicate(fullPath)) result.push(fullPath);
  }
  return result;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest();
}

function readPrivateKey() {
  const privateKeyPem =
    process.env.UPDATE_SIGNING_PRIVATE_KEY ||
    (process.env.UPDATE_SIGNING_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.UPDATE_SIGNING_PRIVATE_KEY_BASE64, "base64").toString("utf8")
      : null) ||
    (fs.existsSync(path.join(root, "secrets", "update-private-key.pem"))
      ? fs.readFileSync(path.join(root, "secrets", "update-private-key.pem"), "utf8")
      : null);
  if (!privateKeyPem) {
    throw new Error("Missing UPDATE_SIGNING_PRIVATE_KEY or secrets/update-private-key.pem.");
  }
  return crypto.createPrivateKey(privateKeyPem);
}

function signBuffer(privateKey, buffer) {
  return crypto.sign(null, buffer, privateKey).toString("base64");
}

function assetPlatform(fileName) {
  if (/mac-universal\.app\.tar\.gz$/i.test(fileName)) return "darwin-universal";
  if (/setup-x64\.exe$/i.test(fileName)) return "win32-x64";
  if (/portable-x64\.exe$/i.test(fileName)) return "win32-x64-portable";
  return null;
}

async function main() {
  const version = normalizeVersion(argValue("--version", pkg.version));
  const tag = argValue("--tag", releaseTag(version));
  const repo = argValue("--repo", process.env.GITHUB_REPOSITORY || "brianxiadong/aihot-mate");
  const releaseDir = path.resolve(argValue("--release-dir", path.join(root, "release")));
  const outDir = path.resolve(argValue("--out-dir", releaseDir));
  const privateKey = readPrivateKey();
  const baseUrl = String(argValue("--base-url", releaseBaseUrl(repo, tag))).replace(/\/$/, "");

  const candidates = findFiles(releaseDir, (filePath) => {
    const name = path.basename(filePath);
    return (
      /mac-universal\.app\.tar\.gz$/i.test(name) ||
      /setup-x64\.exe$/i.test(name) ||
      /portable-x64\.exe$/i.test(name)
    );
  });

  if (candidates.length === 0) {
    throw new Error(`No release assets found under ${releaseDir}`);
  }

  const assets = {};
  for (const filePath of candidates) {
    const fileName = path.basename(filePath).replace(/\s+/g, ".");
    const platform = assetPlatform(fileName);
    if (!platform) continue;

    const normalizedPath = path.join(path.dirname(filePath), fileName);
    if (normalizedPath !== filePath) {
      if (fs.existsSync(normalizedPath)) fs.rmSync(normalizedPath, { force: true });
      fs.renameSync(filePath, normalizedPath);
    }

    const digest = await sha256File(normalizedPath);
    const stat = await fsp.stat(normalizedPath);
    const asset = {
      fileName,
      url: `${baseUrl}/${encodeURIComponent(fileName)}`,
      sha256: digest.toString("hex"),
      size: stat.size,
      signature: signBuffer(privateKey, digest)
    };

    if (platform === "win32-x64-portable") {
      assets["win32-x64-portable"] = asset;
    } else {
      assets[platform] = asset;
    }
  }

  const manifest = {
    schemaVersion: 1,
    appId: pkg.build.appId,
    version,
    releaseTag: tag,
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    publishedAt: new Date().toISOString(),
    assets
  };

  await fsp.mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "latest.json");
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await fsp.writeFile(manifestPath, manifestText);
  await fsp.writeFile(`${manifestPath}.sig`, `${signBuffer(privateKey, Buffer.from(manifestText, "utf8"))}\n`);
  console.log(`Wrote ${manifestPath}`);
  console.log(`Wrote ${manifestPath}.sig`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
