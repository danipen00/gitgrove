# 🌳 GitGrove

A polished desktop **git repository viewer** built with **Electron + React**, using
[`@pierre/trees`](https://trees.software) to render the file tree and
[`@pierre/diffs`](https://diffs.com) to render diffs.

Open any repository, browse your working changes and full commit history, and read
beautiful syntax‑highlighted diffs — split or unified.

![GitGrove changes view](docs/screenshot.png)

## Features

- **Open any git repository** via the native folder picker, with a remembered
  list of recent repos (and a welcome screen to jump back in).
- **Toolbar** with a repository switcher and a searchable **branch switcher**
  (local + remote) that checks branches out in place.
- **Left panel with two tabs:**
  - **Changes** — your working tree rendered as a `@pierre/trees` file tree with
    git‑status coloring (added / modified / deleted / renamed / untracked).
  - **History** — the commit log with refs/tags; select a commit to see its
    changed files as a tree, and click any file to view its diff.
- **Right panel** — the selected file's diff rendered by `@pierre/diffs` with the
  `pierre-dark` theme, word‑level intra‑line highlighting, and **Split / Unified**
  and **line‑wrap** toggles.
- **Live updates** — a filesystem watcher refreshes status and history as you
  commit, checkout, or edit files (tab‑aware, so it never disrupts a diff you're
  reading).
- Resizable panels, persisted UI preferences, large/binary‑diff guards, root‑commit
  handling, and full keyboard‑friendly menus.

## Architecture

```
src/
├── shared/         # types + IPC contract shared by all processes
│   ├── types.ts
│   └── ipc.ts
├── main/           # Electron main process
│   ├── index.ts    # window, menu, IPC handlers
│   ├── git.ts      # git layer (simple-git + execFile for diff/log)
│   ├── store.ts    # recent-repos persistence
│   └── watcher.ts  # debounced filesystem watcher
├── preload/        # contextBridge → window.gitgrove
└── renderer/       # React UI
    └── src/
        ├── App.tsx
        ├── components/   # Toolbar, switchers, ChangesView, HistoryView,
        │                 # FileTreeView, DiffViewer, Popover, Resizer, Welcome
        ├── lib/          # icons + formatting helpers
        └── styles/
```

The renderer talks to git only through a typed `window.gitgrove` bridge
(`contextIsolation` on, `nodeIntegration` off). Git work happens in the main
process via `simple-git` and raw `git` for precise diff/patch output, which is
handed to `@pierre/diffs` as a unified patch string.

## Development

> Requires [Bun](https://bun.sh) and `git` on your PATH.

```bash
bun install        # install dependencies
bun run dev        # launch the app with hot reload
bun run typecheck  # type-check the whole project
```

Verify the git layer or the UI against a real repo:

```bash
bun scripts/test-git.ts [repoPath]   # exercises status/log/diff/commit APIs
node scripts/verify-ui.mjs           # drives the app with Playwright + screenshots
```

## Building distributables

```bash
bun run build        # bundle main / preload / renderer into out/
bun run make:icon    # regenerate build/icon.png from build/icon.svg
bun run dist:mac     # package a .dmg + .zip (also: dist:win, dist:linux)
```

Packaging is configured in `electron-builder.yml`. The app icon lives in
`build/icon.svg`; `make:icon` renders it to `build/icon.png` (1024×1024) with
Playwright, and electron‑builder derives the platform `.icns` / `.ico` from it.

## Releasing & auto-update

GitGrove ships an in-app updater (**electron-updater**) wired to **GitHub
Releases** (`danipen/gitgrove`, configured under `publish:` in
`electron-builder.yml`). On launch it checks quietly in the background; **Help ▸
Check for Updates…** (and the button in the About dialog) run a manual check.
Available updates download automatically and a banner offers to restart and
install.

To cut a release:

```bash
# 1. bump "version" in package.json, commit, and tag (e.g. v1.1.0)
# 2. publish signed/notarized artifacts + the update feed to GitHub Releases:
export GH_TOKEN=<a token with repo scope>
bun run release            # electron-vite build && electron-builder --publish always
```

`release` uploads the installers **and** the `latest*.yml` feed files that
electron-updater reads. Publishing as a *draft* first (electron-builder's
default) lets you write release notes — they surface verbatim in the in-app
update banner / About dialog — before making the release public.

### Code signing (required for macOS auto-update)

Unsigned builds run locally but **macOS will not silently self-update** them:
the updater validates the app signature, and Gatekeeper warns other users. For a
real release, sign and notarize:

- macOS — set `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID Application cert) and
  notarization creds (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`),
  then add a `mac.notarize` block to `electron-builder.yml`.
- Windows — provide a code-signing certificate via `CSC_LINK` / `CSC_KEY_PASSWORD`
  to avoid SmartScreen warnings.

Cross-compiling is limited: build macOS artifacts on macOS, Windows on Windows
(or via Wine), Linux on Linux/Docker.

## Tech stack

Electron · React 19 · electron‑vite · TypeScript · `@pierre/trees` ·
`@pierre/diffs` · Shiki · simple‑git
