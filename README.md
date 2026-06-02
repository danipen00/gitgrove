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
bun run dist:mac     # package a .dmg + .zip (also: dist:win, dist:linux)
```

Packaging is configured in `electron-builder.yml`.

## Tech stack

Electron · React 19 · electron‑vite · TypeScript · `@pierre/trees` ·
`@pierre/diffs` · Shiki · simple‑git
