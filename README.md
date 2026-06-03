# 🌳 GitGrove

A polished desktop **git repository viewer** built with **Electron + React**, using
[`@pierre/trees`](https://trees.software) to render the file tree and
[`@pierre/diffs`](https://diffs.com) to render diffs.

Open any repository, browse your working changes and full commit history, and read
beautiful syntax‑highlighted diffs — split or unified.

![GitGrove history view in light and dark themes](docs/screenshot.png)

## Features

- **Open any git repository** via the native folder picker, with a remembered list
  of recent repos and a welcome screen to jump back in.
- **Branch switcher** (local + remote) that checks branches out in place, alongside
  a repository switcher in the toolbar.
- **Changes** tab — your working tree as a git‑status‑colored file tree (added /
  modified / deleted / renamed / untracked).
- **History** tab — the commit log with refs/tags; pick a commit to see its changed
  files, then click any file for its diff.
- **Diff viewer** with `pierre-dark` theme, word‑level intra‑line highlighting, and
  Split / Unified and line‑wrap toggles.
- **Live updates** — a filesystem watcher refreshes status and history as you commit,
  checkout, or edit, without disrupting a diff you're reading.
- Resizable, persisted panels, large/binary‑diff guards, and root‑commit handling.

The renderer talks to git only through a typed `window.gitgrove` bridge
(`contextIsolation` on, `nodeIntegration` off); git work happens in the main process
via `simple-git` and raw `git` for precise patch output.

## Development

> Requires [Bun](https://bun.sh) and `git` on your PATH.

```bash
bun install        # install dependencies
bun run dev        # launch the app with hot reload
bun run typecheck  # type-check the whole project
bun run lint       # lint + format check (Biome) — same command CI runs
bun run lint:fix   # auto-fix lint + formatting issues
bun test           # run the unit/integration test suite
```

CI runs these exact commands, so green locally means green in CI. Lint and
formatting are handled by [Biome](https://biomejs.dev) (config in `biome.json`);
the ruleset is the standard `recommended` baseline, kept intentionally
un-fussy. Optionally install the Biome editor extension and enable format-on-save
to never think about it again.

### Continuous integration

Pull requests run, across macOS (arm64 + x64), Windows (x64 + arm64) and Linux:
**Lint**, **typecheck + tests + build** per platform, an **E2E smoke** (macOS
arm64 + Windows x64) that launches the app and asserts it renders, and a
**CodeQL** security scan on its default query suite. See `.github/workflows/`.

## Building distributables

```bash
bun run build      # bundle main / preload / renderer into out/
bun run dist:mac   # package a .dmg + .zip (also: dist:win, dist:linux)
```

Packaging is configured in `electron-builder.yml`. The app icon is generated from
`src/renderer/src/assets/icon.svg` by `bun run make:icon`; electron‑builder derives
the platform `.icns` / `.ico` from the resulting `build/icon.png`.

## Releasing & auto-update

GitGrove ships an in-app updater (**electron-updater**) wired to **GitHub Releases**
(configured under `publish:` in `electron-builder.yml`). It checks quietly on launch;
**Help ▸ Check for Updates…** runs a manual check. Updates download automatically and
a banner offers to restart and install.

To cut a release, bump `version` in `package.json`, commit and tag it, then publish:

```bash
export GH_TOKEN=<a token with repo scope>
bun run release    # build + upload installers and the latest*.yml update feed
```

electron-builder publishes as a *draft* by default, so you can write release notes —
they surface verbatim in the in-app update banner — before making it public.

**Code signing** is required for macOS to silently self-update: provide a Developer ID
cert (`CSC_LINK` / `CSC_KEY_PASSWORD`) and notarization credentials (`APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Build each platform's artifacts on its
own OS.

## License

[MIT](LICENSE)
