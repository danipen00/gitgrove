// Mutating git operations for the main process: staging, commits, branches,
// stash, merge/rebase machinery, worktrees and submodules. The shared
// spawn-based runner and per-repo write queue live in exec.ts; network
// operations in sync.ts; the scripted interactive rebase in rebase.ts.
//
// Commit signing (gpg/ssh) is inherited from the user's git config — commits
// run through the real `git commit`, so `commit.gpgsign` et al. apply exactly
// as they do in the terminal.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DiscardItem,
  RepoOpKind,
  ResetMode,
  StashEntry,
  SubmoduleInfo,
  WorktreeInfo
} from '@shared/types'
import { enqueue, type ProgressHandler, run, runOnce, runRead } from './exec'

/** Files restored per checkout-index spawn during a discard — small enough
 *  that each batch completes quickly (a progress report), large enough to
 *  stay a handful of spawns even on ten-thousand-file discards. */
const DISCARD_RESTORE_CHUNK = 1000

// ── Staging ─────────────────────────────────────────────────────────────────

export async function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  // -A so a deleted file stages as a deletion; `--` guards odd filenames.
  await run(repoPath, ['add', '-A', '--', ...paths])
}

/** True when an error means HEAD doesn't resolve (unborn branch, no commits). */
const isUnbornHead = (e: unknown) =>
  e instanceof Error &&
  /ambiguous argument 'HEAD'|unknown revision|Failed to resolve 'HEAD'/i.test(e.message)

export async function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  // On a repo with no commits HEAD doesn't resolve, so unstaging means
  // removing the entry from the index entirely — but ONLY in that case; any
  // other failure must surface, never silently untrack files.
  try {
    await run(repoPath, ['reset', '-q', 'HEAD', '--', ...paths])
  } catch (e) {
    if (!isUnbornHead(e)) throw e
    await run(repoPath, ['rm', '--cached', '-r', '-q', '--', ...paths])
  }
}

export async function stageAll(repoPath: string): Promise<void> {
  await run(repoPath, ['add', '-A'])
}

export async function unstageAll(repoPath: string): Promise<void> {
  try {
    await run(repoPath, ['reset', '-q', 'HEAD', '--', '.'])
  } catch (e) {
    if (!isUnbornHead(e)) throw e
    await run(repoPath, ['rm', '--cached', '-r', '-q', '--', '.'])
  }
}

/** Where each discarded path goes: trashed, forgotten from the index, restored. */
export interface DiscardPlan {
  /** Paths HEAD doesn't have — moved to the OS trash so a mis-click is recoverable. */
  trashPaths: string[]
  /** Paths whose index entries are reset to HEAD (⊇ checkoutPaths). */
  resetPaths: string[]
  /** Paths restored from HEAD into the working tree. */
  checkoutPaths: string[]
}

/**
 * Sort the files of a discard into the three buckets `discardFiles` needs.
 * Discard means: every chosen path ends up exactly as in HEAD. Files HEAD
 * doesn't have — untracked, staged-new, rename targets — are trashed;
 * everything else is reset (unstaged) and restored from HEAD. A rename's R
 * entry lives in the index, so without the reset a discarded rename would
 * survive. Pure + exported for tests.
 */
export function planDiscard(files: DiscardItem[], untrackedPaths: string[]): DiscardPlan {
  const trashPaths = [...untrackedPaths]
  const resetPaths: string[] = []
  const checkoutPaths: string[] = []
  for (const f of files) {
    if (f.oldPath) {
      // Rename/copy: forget both sides, restore the old path, trash the new.
      trashPaths.push(f.path)
      resetPaths.push(f.path, f.oldPath)
      checkoutPaths.push(f.oldPath)
    } else if (f.status === 'added') {
      // Staged new file: nothing in HEAD to restore.
      trashPaths.push(f.path)
      resetPaths.push(f.path)
    } else {
      resetPaths.push(f.path)
      checkoutPaths.push(f.path)
    }
  }
  return { trashPaths, resetPaths, checkoutPaths }
}

/**
 * Throw away changes for tracked paths so they end up exactly as in HEAD,
 * as one atomic step on the write queue:
 *
 *   1. `git reset HEAD` the paths, so staged changes (including renames,
 *      whose R entry lives only in the index) are forgotten. A plain
 *      `checkout -- <path>` restores the worktree *from the index* and would
 *      leave staged state — exactly the bug where a discarded rename
 *      survives;
 *   2. `git checkout-index` the paths that exist in HEAD, writing the
 *      original files back to the worktree.
 *
 * `resetPaths` ⊇ `checkoutPaths`: rename targets and staged-new files are
 * reset but NOT checked out (they don't exist in HEAD — the caller moves
 * them to the OS trash, recoverable, instead). Pathspecs stream over stdin
 * NUL-separated, so a huge selection is two spawns with no argv limits.
 * Untracked files are *not* handled here — the caller trashes those too.
 */
export async function discardFiles(
  repoPath: string,
  resetPaths: string[],
  checkoutPaths: string[],
  onProgress?: ProgressHandler
): Promise<void> {
  if (resetPaths.length === 0 && checkoutPaths.length === 0) return
  await enqueue(repoPath, async () => {
    if (resetPaths.length > 0) {
      onProgress?.('Resetting index', 0)
      const input = resetPaths.join('\0')
      try {
        await runOnce(
          repoPath,
          ['reset', '-q', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'],
          { input }
        )
      } catch (e) {
        // No commits yet: there is no HEAD to reset to — drop the index
        // entries instead (same unborn-branch handling as unstageFiles).
        if (!isUnbornHead(e)) throw e
        await runOnce(
          repoPath,
          ['rm', '--cached', '-r', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'],
          { input }
        )
      }
      onProgress?.('Resetting index', 100)
    }
    // -f overwrites modified worktree files, -u refreshes the index's stat
    // cache so the very next status doesn't re-examine these paths. Restored
    // in chunks so a huge discard reports determinate progress between spawns
    // (checkout-index itself is silent).
    for (let i = 0; i < checkoutPaths.length; i += DISCARD_RESTORE_CHUNK) {
      const chunk = checkoutPaths.slice(i, i + DISCARD_RESTORE_CHUNK)
      await runOnce(repoPath, ['checkout-index', '-f', '-u', '--stdin', '-z'], {
        input: chunk.join('\0')
      })
      onProgress?.(
        'Restoring files',
        Math.round(Math.min(100, ((i + chunk.length) / checkoutPaths.length) * 100))
      )
    }
  })
}

/**
 * Apply a patch to the index and/or working tree. Drives hunk-level staging:
 * the renderer slices the file patch into per-hunk patches and sends them here.
 *  - stage hunk:    cached, !reverse, !workingTree
 *  - unstage hunk:  cached, reverse, !workingTree
 *  - discard hunk:  !cached, reverse, workingTree
 */
export async function applyPatch(
  repoPath: string,
  patch: string,
  opts: { cached?: boolean; reverse?: boolean }
): Promise<void> {
  const args = ['apply', '--whitespace=nowarn']
  if (opts.cached) args.push('--cached')
  if (opts.reverse) args.push('--reverse')
  args.push('-')
  await run(repoPath, args, { input: patch.endsWith('\n') ? patch : `${patch}\n` })
}

// ── Ignore ──────────────────────────────────────────────────────────────────

/**
 * Merge gitignore pattern lines into existing `.gitignore` content: appended
 * at the end, skipping lines already present (compared trimmed of trailing
 * whitespace, which gitignore itself ignores unless escaped). Returns the new
 * content, or null when every pattern is already covered — the caller then
 * leaves the file untouched so the watcher sees no phantom change.
 * Pure + exported for tests.
 */
export function appendIgnoreEntries(existing: string, patterns: string[]): string | null {
  const present = new Set(existing.split('\n').map((l) => l.replace(/\s+$/, '')))
  const missing = patterns.filter((p) => !present.has(p))
  if (missing.length === 0) return null
  const lines = `${missing.join('\n')}\n`
  if (existing === '') return lines
  // Preserve the existing content byte-for-byte; only mend a missing final
  // newline so our first pattern doesn't glue onto the last existing line.
  return existing.endsWith('\n') ? existing + lines : `${existing}\n${lines}`
}

/**
 * Append patterns to the repo root's `.gitignore`, creating it if missing.
 * Plain file I/O, but it rides the write queue: a concurrent checkout or
 * stash could otherwise rewrite `.gitignore` under us and lose the edit.
 */
export async function ignorePatterns(repoPath: string, patterns: string[]): Promise<void> {
  if (patterns.length === 0) return
  await enqueue(repoPath, async () => {
    const file = join(repoPath, '.gitignore')
    const existing = await readFile(file, 'utf8').catch(() => '')
    const updated = appendIgnoreEntries(existing, patterns)
    if (updated !== null) await writeFile(file, updated, 'utf8')
  })
}

// ── Commits ─────────────────────────────────────────────────────────────────

/** What the renderer's checkboxes selected for the next commit. */
export interface CommitSelectionPayload {
  amend?: boolean
  /** Every (non-conflicted) changed file is fully included. */
  all: boolean
  /** Fully included paths, when not `all`. */
  paths: string[]
  /** Standalone hunk patches (HEAD → working tree) for partially included files. */
  patches: string[]
}

/**
 * The checkbox commit model: checkboxes never touch git — this one call
 * does, at commit time, as a single atomic step on the write queue:
 *
 *   1. reset the index to HEAD (the index is scratch space in this model);
 *   2. `git add -A` the fully included paths (NUL pathspecs over stdin, so a
 *      ten-thousand-file selection is one spawn, no argv limits);
 *   3. `git apply --cached` each selected-hunk patch — their old sides are
 *      HEAD coordinates, so they apply cleanly to the just-reset index;
 *   4. `git commit -F -` (signing follows the user's git config).
 */
export async function commitSelection(
  repoPath: string,
  message: string,
  sel: CommitSelectionPayload
): Promise<void> {
  await enqueue(repoPath, async () => {
    try {
      await runOnce(repoPath, ['reset', '-q'])
    } catch (e) {
      if (!isUnbornHead(e)) throw e
    }
    if (sel.all) {
      await runOnce(repoPath, ['add', '-A'])
    } else if (sel.paths.length > 0) {
      await runOnce(repoPath, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        input: sel.paths.join('\0')
      })
    }
    for (const patch of sel.patches) {
      await runOnce(repoPath, ['apply', '--cached', '--whitespace=nowarn', '-'], {
        input: patch.endsWith('\n') ? patch : `${patch}\n`
      })
    }
    const args = ['commit', '-F', '-']
    if (sel.amend) args.push('--amend')
    await runOnce(repoPath, args, { input: message })
  })
}

/** Full message (%B) of HEAD, used to pre-fill the composer when amending. */
export async function lastCommitMessage(repoPath: string): Promise<string> {
  try {
    return (await runRead(repoPath, ['log', '-1', '--format=%B'])).replace(/\n+$/, '')
  } catch {
    return ''
  }
}

// ── Branches ────────────────────────────────────────────────────────────────

export async function createBranch(
  repoPath: string,
  name: string,
  opts: { from?: string; checkout?: boolean } = {}
): Promise<void> {
  const from = opts.from?.trim()
  if (opts.checkout !== false) {
    await run(repoPath, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name])
  } else {
    await run(repoPath, from ? ['branch', name, from] : ['branch', name])
  }
}

export async function deleteBranch(
  repoPath: string,
  name: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  await run(repoPath, ['branch', opts.force ? '-D' : '-d', name])
}

export async function renameBranch(repoPath: string, from: string, to: string): Promise<void> {
  await run(repoPath, ['branch', '-m', from, to])
}

/**
 * Switch branches. Checkout rewrites HEAD, the index and the working tree, so
 * it MUST ride the write queue — running it concurrently with a stage/commit
 * is exactly the index.lock race the queue exists to prevent. Progress comes
 * from git's "Updating files: N%" stream (emitted only on non-trivial switches).
 */
export async function checkoutBranch(
  repoPath: string,
  branch: string,
  onProgress?: ProgressHandler
): Promise<void> {
  await run(repoPath, ['checkout', '--progress', branch], { onProgress })
}

/** Check out a commit directly, leaving HEAD detached. */
export async function checkoutDetached(repoPath: string, hash: string): Promise<void> {
  await run(repoPath, ['checkout', '--detach', hash])
}

// ── Merge / rebase / cherry-pick / revert / reset ───────────────────────────

export async function merge(repoPath: string, branch: string): Promise<void> {
  await run(repoPath, ['-c', 'core.editor=true', 'merge', '--no-edit', branch])
}

export async function rebase(repoPath: string, onto: string): Promise<void> {
  await run(repoPath, ['-c', 'core.editor=true', 'rebase', onto])
}

export async function cherryPick(repoPath: string, hash: string): Promise<void> {
  await run(repoPath, ['cherry-pick', hash])
}

export async function revertCommit(repoPath: string, hash: string): Promise<void> {
  await run(repoPath, ['revert', '--no-edit', hash])
}

export async function reset(repoPath: string, hash: string, mode: ResetMode): Promise<void> {
  await run(repoPath, ['reset', `--${mode}`, hash])
}

/**
 * Continue or abort whatever multi-step operation is in flight. `core.editor=
 * true` accepts git's prepared message without opening an editor.
 */
export async function continueOp(repoPath: string, op: RepoOpKind): Promise<void> {
  const sub =
    op === 'merging'
      ? ['merge', '--continue']
      : op === 'rebasing'
        ? ['rebase', '--continue']
        : op === 'cherry-picking'
          ? ['cherry-pick', '--continue']
          : ['revert', '--continue']
  await run(repoPath, ['-c', 'core.editor=true', ...sub])
}

export async function abortOp(repoPath: string, op: RepoOpKind): Promise<void> {
  const sub =
    op === 'merging'
      ? ['merge', '--abort']
      : op === 'rebasing'
        ? ['rebase', '--abort']
        : op === 'cherry-picking'
          ? ['cherry-pick', '--abort']
          : ['revert', '--abort']
  await run(repoPath, sub)
}

/** Skip the current commit of an in-progress rebase. */
export async function skipRebaseCommit(repoPath: string): Promise<void> {
  await run(repoPath, ['rebase', '--skip'])
}

/** Resolve a conflicted path by taking one side wholesale, then stage it. */
export async function resolveConflict(
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  await run(repoPath, ['checkout', side === 'ours' ? '--ours' : '--theirs', '--', path])
  await run(repoPath, ['add', '--', path])
}

/** Mark a conflicted path resolved as currently saved on disk. */
export async function markResolved(repoPath: string, path: string): Promise<void> {
  await run(repoPath, ['add', '--', path])
}

// ── Stash ───────────────────────────────────────────────────────────────────

/** Field count of the stash-list format below. */
const STASH_FIELDS = 4

/**
 * Parse `git stash list -z` in our NUL-joined `%gd %H %gs %cr` format: a flat
 * NUL stream read in groups of four. NUL because `%gs` carries the user's
 * stash message, which can contain any byte except NUL. Exported for tests.
 */
export function parseStashList(out: string): StashEntry[] {
  const tokens = out.split('\0')
  const entries: StashEntry[] = []
  for (let i = 0; i + STASH_FIELDS <= tokens.length; i += STASH_FIELDS) {
    const [ref, sha, message, relativeDate] = tokens.slice(i, i + STASH_FIELDS)
    const m = ref.match(/stash@\{(\d+)\}/)
    if (!m) continue
    entries.push({
      index: Number(m[1]),
      sha,
      // `%gs` looks like "On main: message" or "WIP on main: deadbeef Subject".
      message: message.replace(/^(WIP on|On) [^:]+: /, ''),
      relativeDate
    })
  }
  return entries
}

export async function listStashes(repoPath: string): Promise<StashEntry[]> {
  const out = await runRead(repoPath, [
    'stash',
    'list',
    '-z',
    '--format=%gd%x00%H%x00%gs%x00%cr'
  ]).catch(() => '')
  return parseStashList(out)
}

export async function stashSave(
  repoPath: string,
  opts: { message?: string; includeUntracked?: boolean; paths?: string[] } = {}
): Promise<void> {
  const args = ['stash', 'push']
  if (opts.includeUntracked !== false) args.push('-u')
  if (opts.message?.trim()) args.push('-m', opts.message.trim())
  // Stash only the given paths (NUL pathspecs over stdin — no argv limits).
  if (opts.paths && opts.paths.length > 0) {
    args.push('--pathspec-from-file=-', '--pathspec-file-nul')
    await run(repoPath, args, { input: opts.paths.join('\0') })
    return
  }
  await run(repoPath, args)
}

export async function stashApply(repoPath: string, index: number, pop: boolean): Promise<void> {
  await run(repoPath, ['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function stashDrop(repoPath: string, index: number): Promise<void> {
  await run(repoPath, ['stash', 'drop', `stash@{${index}}`])
}

// ── Tags ────────────────────────────────────────────────────────────────────

export async function createTag(
  repoPath: string,
  name: string,
  opts: { hash?: string; message?: string; push?: boolean } = {}
): Promise<void> {
  const args = opts.message?.trim()
    ? ['tag', '-a', name, '-m', opts.message.trim()]
    : ['tag', name]
  if (opts.hash) args.push(opts.hash)
  await run(repoPath, args)
  if (opts.push) {
    const remotes = (await run(repoPath, ['remote']).catch(() => '')).split('\n').filter(Boolean)
    if (remotes.length > 0) await run(repoPath, ['push', remotes[0].trim(), name])
  }
}

export async function deleteTag(repoPath: string, name: string): Promise<void> {
  await run(repoPath, ['tag', '-d', name])
}

// ── Worktrees ───────────────────────────────────────────────────────────────

/** Parse `git worktree list --porcelain`. Exported for tests. */
export function parseWorktrees(out: string, currentPath: string): WorktreeInfo[] {
  const blocks = out.split('\n\n').filter((b) => b.trim())
  return blocks.map((block, i) => {
    const lines = block.split('\n')
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
    const head = lines.find((l) => l.startsWith('HEAD '))?.slice('HEAD '.length) ?? ''
    const branchRef = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length)
    return {
      path,
      branch: branchRef ? branchRef.replace(/^refs\/heads\//, '') : null,
      headShort: head.slice(0, 7),
      isMain: i === 0,
      isCurrent: path === currentPath
    }
  })
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const out = await runRead(repoPath, ['worktree', 'list', '--porcelain'])
  return parseWorktrees(out, repoPath)
}

export async function addWorktree(
  repoPath: string,
  path: string,
  opts: { branch?: string; newBranch?: string } = {}
): Promise<void> {
  const args = ['worktree', 'add']
  if (opts.newBranch) args.push('-b', opts.newBranch)
  args.push(path)
  if (opts.branch) args.push(opts.branch)
  await run(repoPath, args)
}

export async function removeWorktree(
  repoPath: string,
  path: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(path)
  await run(repoPath, args)
}

// ── Submodules ──────────────────────────────────────────────────────────────

/** Parse `git submodule status` output. Exported for tests. */
export function parseSubmodules(out: string): SubmoduleInfo[] {
  const mods: SubmoduleInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    // "<flag><sha> <path> (<describe>)" — flag is ' ', '+', '-', or 'U'.
    const m = line.match(/^([ +\-U])([0-9a-f]+) (\S+)/)
    if (!m) continue
    const [, flag, sha, path] = m
    mods.push({
      path,
      shaShort: sha.slice(0, 7),
      state:
        flag === '-'
          ? 'uninitialized'
          : flag === '+'
            ? 'modified'
            : flag === 'U'
              ? 'conflict'
              : 'clean'
    })
  }
  return mods
}

export async function listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  const out = await runRead(repoPath, ['submodule', 'status']).catch(() => '')
  return parseSubmodules(out)
}

export async function updateSubmodules(repoPath: string): Promise<void> {
  await run(repoPath, ['submodule', 'update', '--init', '--recursive'])
}

// ── Large-repo optimizations ────────────────────────────────────────────────

/**
 * Enable git's built-in machinery for huge working trees — the same levers
 * git itself recommends (and `scalar` applies) for monorepos:
 *
 *  - `core.fsmonitor` — a daemon tells git *which* paths changed, so `status`
 *    stops lstat-crawling the whole tree (seconds → tens of ms);
 *  - `core.untrackedCache` — cached untracked-file enumeration;
 *  - index version 4 — prefix-compressed index, much faster to read/write
 *    (this is what makes a one-file `git add`/`reset` fast on 90k entries).
 *
 * Finishes with one cache-warming `git status` that is *allowed* to take
 * optional locks, so the fsmonitor token and untracked cache persist
 * immediately instead of on the next write.
 */
export async function optimizeRepo(repoPath: string): Promise<void> {
  await run(repoPath, ['config', 'core.untrackedCache', 'true'])
  // `core.fsmonitor true` means the *built-in* daemon only on git ≥ 2.37
  // (macOS/Windows); on older gits it would be misread as a hook path and
  // make every status warn. The other levers still help by themselves.
  const version = (await runRead(repoPath, ['--version']).catch(() => '')).match(/(\d+)\.(\d+)/)
  const fsmonitorSupported =
    version !== null &&
    (Number(version[1]) > 2 || (Number(version[1]) === 2 && Number(version[2]) >= 37)) &&
    process.platform !== 'linux'
  if (fsmonitorSupported) {
    await run(repoPath, ['config', 'core.fsmonitor', 'true']).catch(() => {})
  }
  await run(repoPath, ['update-index', '--index-version', '4'])
  // Cache-warming status that is allowed to take optional locks, so the
  // untracked cache (and fsmonitor token) persist right away.
  await run(repoPath, ['status', '--porcelain=2', '-z', '--untracked-files=all'], {
    env: { GIT_OPTIONAL_LOCKS: '1' }
  })
}
