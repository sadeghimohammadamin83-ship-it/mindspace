# MINDSPACE — Windows release guide (Phase 10)

Version **0.1.0**, target **Windows x64** (Windows 10/11). Packaging tool: **electron-builder 26.15.3** (NSIS installer + portable), configured in `electron-builder.yml`. Chosen over Electron Forge because the project already uses electron-vite (Forge expects its own Vite/webpack plugin layout) and electron-builder needs no change to the build or the `out/` layout.

## Build
```
npm ci
npm run release:win      # typecheck → electron-vite build → electron-builder (NSIS + portable) → checksums + manifest
```
- On Windows this also edits the exe icon/version resources (needs `winCodeSign` download; enable Developer Mode or run elevated if symlink extraction fails).
- Building from Linux is possible with Wine (`wine` + `wine32:i386`) and `npm run build:win:linux`; it was used for the artifacts in this phase.
- Output (git-ignored): `release/`
  - `MINDSPACE-Setup-0.1.0-x64.exe` — NSIS installer
  - `MINDSPACE-Portable-0.1.0-x64.exe` — portable
  - `SHA256SUMS.txt`, `release-manifest.json` — generated from the real files by `scripts/release-manifest.cjs`
- Dependencies used only by the renderer (React, Radix, motion, lucide, fonts, liquid-gooey…) are `devDependencies`: Vite bundles them into `out/renderer`, so they are not shipped in `node_modules`. Source maps and non-Windows native binaries are excluded.

## Native modules and assets
- `better-sqlite3` 13 (Node-API, prebuilt `win32-x64.node`; no rebuild needed, `npmRebuild: false`) and `onnxruntime-node` (`bin/napi-v6/win32/x64`, DLLs) are unpacked from `app.asar` (`asarUnpack`).
- `pdfjs-dist` (legacy build) and its worker run from `app.asar`; `@napi-rs/canvas` Windows binary is optional for pdf.js and is installed only when building for Windows from a Linux host with `npm i --no-save --force --os=win32 --cpu=x64 @napi-rs/canvas-win32-x64-msvc@1.0.11`.
- No embedding model is bundled. It is downloaded from Settings (sha256-verified) into the user-data folder. Without it the app shows the setup state and keyword search still works.

## AI providers
Ollama is optional and external (install and run it yourself; default `localhost`). Anthropic/OpenAI keys are entered in Settings after install and stored encrypted with Electron `safeStorage` in the user-data folder; nothing is in the installer. Nothing is sent to a cloud provider unless one is configured and chosen.

## User data
- Installed and portable builds both use `%APPDATA%\MINDSPACE` (same name as development; changing the product name or `appId` would create a new empty profile — do not change them). Contents: `mindspace.sqlite3` (+WAL), `documents/`, `models/`, `ai-credentials.json`, `backups/`, restore journal.
- Never inside the install directory. `MINDSPACE_USER_DATA_DIR` is ignored in packaged builds.
- **Uninstall keeps user data** (`deleteAppDataOnUninstall: false`); remove `%APPDATA%\MINDSPACE` manually for a full wipe. Upgrades install over the same `appId` and the database migrates at next start.
- Back up with Settings → Backup (`.msbak`); the key file and the model are not included in backups.
- Portable: same `%APPDATA%\MINDSPACE`, not the exe folder (so it works from read-only media, and shares data with an installed copy). Do not run two versions against the same profile at once (single-instance lock applies).

## Signing
**Unsigned.** No certificate is configured. Windows SmartScreen / "Unknown publisher" warnings are expected ("More info → Run anyway"). Public distribution needs a code-signing certificate (set `CSC_LINK`/`CSC_KEY_PASSWORD`); SmartScreen reputation is not guaranteed even then.

## Icon
`build/icon.ico` / `build/icon.png` are **temporary placeholders generated for this build**, not an approved brand asset. Replace both before public release.

## Manual test on Windows
1. Use a spare user or VM. Run `MINDSPACE-Setup-0.1.0-x64.exe`, accept the SmartScreen prompt, pick a folder, tick the desktop shortcut.
2. Launch from the Start Menu; confirm window opens, `%APPDATA%\MINDSPACE\mindspace.sqlite3` is created.
3. Create a note, task, project; import a PDF; search a phrase from page 3; quit and relaunch; data remains.
4. Settings → Backup: create a backup. Settings → Semantic: download the model if online.
5. Install the same version over itself (upgrade): data remains. Uninstall: data folder remains.
6. Compare `certutil -hashfile <exe> SHA256` with `SHA256SUMS.txt`.

## Checks and their status
See the phase 10 report (`phase10-report.md`) for the exact results and what could not be verified.
