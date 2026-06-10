# 🌳 GitGrove

A fast, beautiful desktop git client. Open any repo to stage hunk by hunk, commit,
branch, sync, stash, rebase interactively — and read syntax‑highlighted diffs that
are a pleasure to look at, split or unified, light or dark.

GitGrove keeps a viewer's calm: one window, two tabs, no ceremony. The full power
of git is there when you reach for it, and invisible when you don't.

![GitGrove history view in light and dark themes](docs/screenshot.png)

## Install

Download the latest version for your platform from the
[**Releases page**](https://github.com/danipen/gitgrove/releases/latest):

- **macOS** — `.dmg` (Intel / Apple Silicon)
- **Windows** — `.exe` installer (x64 / arm64)
- **Linux** — `.AppImage`

GitGrove updates itself: it checks quietly on launch and offers a one‑click restart
when a new version is ready. You can also check any time from **Help ▸ Check for
Updates…**

> **You'll need `git` installed.** GitGrove reads repositories through the `git`
> command line. If it isn't found, the app walks you through installing it (and will
> happily use the copy bundled with GitHub Desktop).

## What you can do

- **Open or clone any repository** from the folder picker, a URL, or the recents on
  the welcome screen.
- **Pick what to commit with checkboxes** — every file has one, and every change
  block in the diff has its own, inline in one continuous, context‑expandable view.
  Checkboxes are instant (they never touch git); the selection is applied once, at
  commit time. Discards are guarded: untracked files go to the system trash, never
  `rm`.
- **Commit and amend** from the composer (⌘↵), with your configured commit signing
  (GPG/SSH) applied exactly as in the terminal.
- **Fetch, pull, push** from one adaptive toolbar button with ahead/behind badges —
  publish new branches, pull with rebase, or force‑push with `--force-with-lease`
  behind an explicit confirmation. A quiet background fetch keeps the counts honest.
- **Manage branches** from the switcher: create, rename, delete (with an unmerged
  safety net), merge or rebase onto the current branch.
- **Rewrite history carefully** — right‑click any commit to cherry‑pick, revert,
  tag, branch, reset (soft/mixed/hard), or start an **interactive rebase**: reorder,
  squash, fixup, reword and drop in a visual todo editor; no terminal editor ever
  opens.
- **Resolve conflicts in place** — when a merge/rebase/cherry‑pick stops, a banner
  shows the state and conflicted files offer *ours/theirs/mark resolved*, then
  continue, skip or abort.
- **Stash** with a message (untracked included), then apply, pop or drop from the
  stash list.
- **Work across worktrees and submodules** from the Repository menu — list, add,
  remove and open them as repos.
- **Explore history** in the **History** tab and **read diffs that are a pleasure
  to read** — word‑level highlighting, Split or Unified, line wrap, expandable
  context.
- **Stay in sync automatically** — GitGrove watches the repo and refreshes as you
  commit, checkout, or edit, without disrupting the diff you're reading.

Destructive actions always ask first, and never more than once when they don't
need to.

## Contributing

GitGrove is an [Electron](https://www.electronjs.org) + [React](https://react.dev)
app. The renderer never touches git directly: it talks to the main process through a
typed, sandboxed bridge (`contextIsolation` on, `nodeIntegration` off), and all git
work happens in the main process via [`simple-git`](https://github.com/steveukx/git-js)
and raw `git` for precise patch output. Write operations (`src/main/git-write.ts`)
shell out to the same binary with prompting disabled, so credentials and signing
come from the user's own git configuration; the interactive rebase is fully
scripted through `GIT_SEQUENCE_EDITOR`/`GIT_EDITOR` shims. Diffs are rendered with [`@pierre/diffs`](https://diffs.com).

You'll need [Bun](https://bun.sh) and `git` on your PATH.

```bash
bun install        # install dependencies
bun run dev        # launch the app with hot reload
bun run typecheck  # type-check the whole project
bun test           # run the test suite
bun run lint       # lint + format check (Biome) — same command CI runs
bun run lint:fix   # auto-fix lint + formatting
```

CI runs lint, typecheck, tests and a per‑platform build on every PR (macOS, Windows,
Linux), plus an end‑to‑end smoke test and a CodeQL scan — so green locally means green
in CI.

### Cutting a release

Releases are one button: **Actions ▸ Release ▸ Run workflow**, pick the bump level. The
workflow bumps the version, tags it, builds installers on every OS, and opens a draft
GitHub Release with generated notes. Review the notes (they show verbatim in the in‑app
update banner) and click **Publish**.

## License

GitGrove's own source is [MIT](LICENSE). It bundles open‑source dependencies under
their own permissive licenses; their notices ship inside every distributable.
</content>
