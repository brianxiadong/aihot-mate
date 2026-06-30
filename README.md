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
