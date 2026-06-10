# GitGrove

A fast, beautiful desktop git client. Electron + React 19 + TypeScript, diffs by
`@pierre/diffs`. The whole point: **full power of git, silly-simple UI** — one window,
two tabs, no ceremony.

## Principles (the bar every change is held to)

- **Clean code — the most important principle.** Clean for humans *and* for LLMs. Names
  (files, classes, methods, vars) are precise and reveal intent. Methods are small and
  readable; files stay small — when something grows, split it into meaningful, cohesive
  pieces. No clever tricks, no dead code, no duplication. Optimize for the next reader.
- **Max UX.** Advanced git (interactive rebase, hunk-level staging, worktrees, conflict
  resolution) must feel effortless — never drop the user into a terminal, editor, or git
  jargon they didn't ask for.
- **Simple UI, powerful engine.** Complexity lives in the main process, never in the
  user's face. If a feature needs explaining, the design isn't done.
- **Elegant, fast, reliable, beautiful** — UI *and* code. Two themes, one calm layout.
  Reads never block writes; checkboxes never touch git. Destructive actions ask once.

Favor fewer, sharper features over more knobs. Ask: *does this keep the UI silly-simple
while letting an expert reach for real git power?*

## Architecture

Three isolated layers; the renderer **never** touches git or Node directly.

```
src/main/     Node + Electron. All git work, by shelling out to the raw `git` binary.
src/preload/  Typed, sandboxed bridge (contextIsolation on, nodeIntegration off).
src/renderer/ React 19 UI. Talks to main only through window.gitgrove.
src/shared/   Types + the IPC contract, imported by all three.
```

**The IPC contract is the spine** (`src/shared/ipc.ts`, types in `types.ts`). Adding a
capability touches, in order: `shared/types.ts` → `shared/ipc.ts` (channel + `GitGroveApi`
method) → `preload/index.ts` (forward the invoke) → `main/index.ts` (`ipcMain.handle`) →
renderer. Don't bypass it.

**Git layer (`src/main/`)** — no wrapper library; a single `execFile`/`spawn` entry point
with exact control over args and exit codes (the GitHub Desktop approach). Read it before
adding git calls — its conventions are load-bearing:
- `git.ts` (read side): `GIT_OPTIONAL_LOCKS=0` so reads never take the index lock; all
  path/text output is **NUL-delimited** (`-z`/`%x00`).
- `git-write.ts` (write side): mutating ops **serialized per repo** via a write queue +
  lock retry ladder; never prompt (`GIT_TERMINAL_PROMPT` off); signing inherited from the
  user's git config; interactive rebase scripted via editor shims — **no terminal editor
  opens.**
- `git-bin.ts` locates git (PATH, then GitHub Desktop's copy); `git-status.ts` snapshots;
  `watcher.ts` pushes `repo:changed`; `updater.ts`, `store.ts`.

**Renderer (`src/renderer/src/`)** — `App.tsx` (state, the two tabs, modals), `components/`
(one per file, UI only), `lib/staging.ts` (**heart of hunk-level staging**: checkboxes are
pure renderer state, git touched only at commit time; the change block is rendered to a
unified patch and `git apply --cached`'d), `styles/global.css` (two themes, one layout).

## Commands

**Bun** for installs/tests/scripts; `git` must be on PATH.

```bash
bun run dev        # launch with hot reload
bun run dev:debug  # same, CDP on :9222 for Playwright attach
bun run typecheck  # tsc --noEmit
bun test           # bun:test (*.test.ts colocated with source)
bun run lint       # biome check . — exactly what CI runs (lint:fix to auto-fix)
bun run e2e        # Playwright Electron smoke test (builds first)
```

Before claiming done, run `lint`, `typecheck`, and `test` — green locally means green in
CI. (`bun` may not be on PATH in tool shells — prefix `export PATH="$HOME/.bun/bin:$PATH";`.)

**Validate visually with Playwright.** For anything complex or that needs to be seen —
UI, layout, diff rendering, themes, multi-step flows — drive the real app, don't just
trust types and tests. **Always use the `playwright-cli` skill for this** (it's
installed) — don't hand-roll Playwright calls. The flow: `bun run dev:debug`, then attach
over CDP and exercise/screenshot the change. (`scripts/verify-ui.mjs` shows the launch
pattern.) Beauty and UX are verified on screen, not in the diff.

## Conventions

- **Biome enforces style**: single quotes, no semicolons, 2-space indent, 100 cols, no
  trailing commas. Run `lint:fix`, don't hand-format.
- **Path aliases:** `@/` → `src/renderer/src/`, `@shared/` → `src/shared/`.
- **Comments explain *why*, richly** (lock semantics, NUL delimiting, PATH probing).
  Match that density on tricky code; don't strip existing rationale.
- **Tests** are colocated `*.test.ts`; git tests are integration tests driving the real
  `git` binary against a throwaway repo, not mocks. TypeScript is strict — no new `any`.
- **Every new behaviour or spec change ships with unit tests.** Tests must be
  **reliable, never flaky** — no timing races, no shared mutable state, no ordering
  assumptions. Design for testability *before* writing code: keep logic pure and
  separable (see `lib/staging.ts`), so it can be tested directly without driving the UI.
