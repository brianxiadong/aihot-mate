const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const secretsDir = path.join(root, "secrets");
const privateKeyPath = path.join(secretsDir, "update-private-key.pem");
const privateKeyBase64Path = path.join(secretsDir, "update-private-key.base64.txt");
const publicKeyModulePath = path.join(root, "src", "main", "update-public-key.cjs");

if (fs.existsSync(privateKeyPath)) {
  throw new Error(`Refusing to overwrite existing private key: ${privateKeyPath}`);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

fs.mkdirSync(secretsDir, { recursive: true });
fs.writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
fs.writeFileSync(privateKeyBase64Path, `${Buffer.from(privateKeyPem, "utf8").toString("base64")}\n`, { mode: 0o600 });
fs.writeFileSync(
  publicKeyModulePath,
  `module.exports = {\n  publicKeyPem: ${JSON.stringify(publicKeyPem)}\n};\n`
);

console.log(`Wrote private key: ${path.relative(root, privateKeyPath)}`);
console.log(`Wrote private key secret value: ${path.relative(root, privateKeyBase64Path)}`);
console.log(`Wrote public key module: ${path.relative(root, publicKeyModulePath)}`);
console.log("Set GitHub Actions secret UPDATE_SIGNING_PRIVATE_KEY_BASE64 to the contents of the base64 file.");
