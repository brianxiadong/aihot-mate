# AIHOT Mate

AIHOT Mate is a cross-platform desktop companion for AI news feeds. It keeps a local inbox of AI updates, alerts on important new items, and opens full content inside the desktop app without forcing a browser hop.

## First release scope

- Electron desktop app for Windows and macOS.
- Draggable always-on-top desktop pet window.
- Pet-attached mini reader for quick new-item reading without opening the main app.
- Embedded original-page reader for items whose extracted article text is incomplete.
- Built-in AIHOT source adapter.
- Generic RSS source adapter for future feed expansion.
- Local JSON cache for items, read state, favorites, saved items, settings, and article cache.
- System tray/menu-bar entry.
- New-content notifications with basic priority filtering.
- Full-content reader via AIHOT permalink/RSS item extraction, with browser-open fallback.
- AIHOT Mate pet skin generated with `gpt-image-2`; runtime asset: `assets/pet/aihot-mate-pet-runtime.png`.

## Development

Use the bundled Node/pnpm in Codex or a local Node.js 22+ install.

```powershell
pnpm install
pnpm electron:dev
```

## Build

```powershell
pnpm dist:win
```

macOS artifacts must be produced on macOS:

```bash
pnpm dist:mac
```

Unsigned builds are intended for internal first-release testing. Public distribution should add Windows code signing and Apple notarization.

## Signed GitHub Release updates

AIHOT Mate includes a custom GitHub Release updater for internal distribution. It does not require Apple Developer ID signing, but it does not bypass macOS Gatekeeper on first install. The update channel uses an app-embedded Ed25519 public key and verifies both `latest.json` and the downloaded update asset before installing.

Release assets produced by CI include:

- `latest.json`
- `latest.json.sig`
- `AIHOT.Mate-<version>-mac-universal.app.tar.gz`
- Windows installer / portable executables

Generate the updater key pair once:

```powershell
pnpm update:keys
```

Commit only `src/main/update-public-key.cjs`. Never commit `secrets/`. Add the contents of `secrets/update-private-key.base64.txt` to the GitHub Actions secret:

```text
UPDATE_SIGNING_PRIVATE_KEY_BASE64
```

Local verification:

```powershell
pnpm dist:win
pnpm update:sign -- --version 0.1.2 --tag v0.1.2 --release-dir release --out-dir release
pnpm update:verify -- --manifest release/latest.json --asset-root release
```

macOS installation remains unsigned unless Apple Developer ID signing/notarization is added later. Once the app is running, updates are accepted only if the manifest and update archive match the embedded updater public key.
