const fs = require("node:fs");
const path = require("node:path");

module.exports = async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const iconPath = path.join(context.packager.projectDir, "assets", "icons", "icon.ico");
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Windows icon is missing: ${iconPath}`);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Windows executable is missing: ${exePath}`);
  }

  const { rcedit } = await import("rcedit");
  await rcedit(exePath, { icon: iconPath });
};
