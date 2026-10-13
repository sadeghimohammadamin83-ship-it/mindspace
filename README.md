# MINDSPACE

A local-first "second brain" desktop app for Windows: notes, documents, projects, tasks and decisions in one workspace, with keyword and semantic search and source-cited AI answers.

**Website:** https://sadeghimohammadamin83-ship-it.github.io/mindspace/

## Download
The Windows (x64) installer is not published yet. When it is, it will be a release asset named `MINDSPACE-Setup.exe` on the [Releases page](https://github.com/sadeghimohammadamin83-ship-it/mindspace/releases). The installer is unsigned (SmartScreen may warn) and has not been run on real Windows by the author yet.

## Repository layout
- `website/` — the static product website (React + TypeScript + Vite). Independent package; no Electron code.
- `app/` — the MINDSPACE Electron desktop app (see `app/README.md`, `app/docs/RELEASING.md`). Desktop dev: `cd app && npm ci && npm run dev`.

## Website development
```
cd website
npm ci
npm run dev        # local dev server
npm run build      # typecheck + production build into website/dist
npm run check      # verify built asset paths and no third-party hosts
```
Release availability is controlled by one file: `website/src/config.ts` (`released`, `version`). Set `released: true` only once a public release contains `MINDSPACE-Setup.exe`. For a custom domain, build with `SITE_BASE=/`.

## Deployment
`.github/workflows/deploy-website.yml` builds `website/` and deploys `website/dist` with GitHub Pages on pushes to `main` that touch `website/` (or manually). In repository Settings → Pages, the source must be **GitHub Actions**.

## Bugs
Open an [issue](https://github.com/sadeghimohammadamin83-ship-it/mindspace/issues). Do not include private notes or API keys.

## Known limitations
Windows x64 only; no OCR for scanned PDFs; no sync; cloud/local AI providers verified only against simulated services; border-beam/metal-fx effects are not part of the app.
