const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(__dirname, "..");
const { publicKeyPem } = require(path.join(root, "src", "main", "update-public-key.cjs"));

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function findFileByName(dir, fileName) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const match = findFileByName(fullPath, fileName);
      if (match) return match;
    } else if (entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest();
}

function verify(buffer, signatureBase64) {
  return crypto.verify(null, buffer, crypto.createPublicKey(publicKeyPem), Buffer.from(signatureBase64.trim(), "base64"));
}

async function main() {
  if (!publicKeyPem) {
    throw new Error("Update public key is not configured.");
  }

  const manifestPath = path.resolve(argValue("--manifest", path.join(root, "release", "latest.json")));
  const assetRoot = path.resolve(argValue("--asset-root", path.dirname(manifestPath)));
  const manifestText = await fsp.readFile(manifestPath, "utf8");
  const manifestSig = await fsp.readFile(`${manifestPath}.sig`, "utf8");
  if (!verify(Buffer.from(manifestText, "utf8"), manifestSig)) {
    throw new Error("Manifest signature is invalid.");
  }

  const manifest = JSON.parse(manifestText);
  for (const asset of Object.values(manifest.assets || {})) {
    const filePath = findFileByName(assetRoot, asset.fileName);
    if (!filePath) {
      throw new Error(`${asset.fileName} is missing under ${assetRoot}`);
    }
    const digest = await sha256File(filePath);
    const digestHex = digest.toString("hex");
    if (digestHex !== asset.sha256) {
      throw new Error(`${asset.fileName} hash mismatch.`);
    }
    if (!verify(digest, asset.signature)) {
      throw new Error(`${asset.fileName} signature is invalid.`);
    }
    console.log(`Verified ${asset.fileName}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
