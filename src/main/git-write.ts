// Mutating git operations for the main process: staging, commits, sync,
// branches, stash, merge/rebase machinery, worktrees, submodules and clone.
//
// Everything here shells out to the same `git` binary the read layer uses
// (locateGit), via a small spawn-based runner that supports stdin (for
// `git apply` / `git commit -F -`) and per-call environment overrides (for the
// non-interactive rebase editors). Commands never prompt: GIT_TERMINAL_PROMPT
// is off, so a missing credential fails fast with a readable error instead of
// hanging the app. Commit signing (gpg/ssh) is inherited from the user's git
// config — commits run through the real `git commit`, so `commit.gpgsign`
// et al. apply exactly as they do in the terminal.

import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type {
  RebaseTodoItem,
  RepoOpKind,
  RepoState,
  ResetMode,
  StashEntry,
  SubmoduleInfo,
  SyncStatus,
  WorktreeInfo
} from '@shared/types'
import { locateGit } from './git-bin'

interface RunOptions {
  /** Text piped to git's stdin (e.g. a patch for `git apply -`). */
  input?: string
  /** Extra environment variables layered over the process env. */
  env?: Record<string, string>
  /** Exit codes (besides 0) treated as success; stdout is still returned. */
  tolerateExitCodes?: number[]
  /**
   * Receives phase + percent parsed from git's stderr progress stream while
   * the command runs. The caller must also pass `--progress` — git suppresses
   * progress when stderr is not a terminal.
   */
  onProgress?: ProgressHandler
}

type ProgressHandler = (phase: string, percent: number) => void

/**
 * Extract progress reports from a chunk of git stderr. git updates a phase in
 * place with \r-separated lines like "Receiving objects:  42% (1234/2934)"
 * (server-side phases prefixed with "remote: "). Pure + exported for tests.
 */
export function parseProgressText(text: string, onProgress: ProgressHandler): void {
  for (const line of text.split(/[\r\n]/)) {
    const m = line.match(/^(?:remote: )?([A-Za-z- ]+):\s+(\d+)%/)
    if (m) onProgress(m[1], Number(m[2]))
  }
}

/**
 * Per-repo write queue. Two mutating git commands on the same repo must never
 * overlap — both would race for .git/index.lock and one dies with "Unable to
 * create index.lock: File exists". The renderer serializes user actions, but
 * watcher-driven work and menu commands can still interleave, so the real
 * guarantee lives here.
 */
const writeQueues = new Map<string, Promise<unknown>>()

function enqueue<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const tail = writeQueues.get(repoPath) ?? Promise.resolve()
  // Chain regardless of the predecessor's outcome; failures propagate to their
  // own caller only.
  const next = tail.then(task, task)
  writeQueues.set(repoPath, next.catch(() => {}))
  return next
}

/** Lock-contention retry schedule (ms). Covers a terminal/editor briefly holding the lock. */
const LOCK_RETRY_DELAYS = [150, 400, 900]

/** Files restored per checkout-index spawn during a discard — small enough
 *  that each batch completes quickly (a progress report), large enough to
 *  stay a handful of spawns even on ten-thousand-file discards. */
const DISCARD_RESTORE_CHUNK = 1000

const isLockError = (message: string) =>
  /index\.lock|\.lock['"]?: File exists|Another git process/i.test(message)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run a mutating git command: serialized per repo, with a short retry ladder
 * when an *external* process (editor git plugin, terminal) is holding the
 * index lock. Errors carry git's stderr (or stdout — some commands like
 * `merge` report conflicts there) so the renderer toast shows the real reason.
 */
async function run(repoPath: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return enqueue(repoPath, async () => {
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= LOCK_RETRY_DELAYS.length; attempt++) {
      try {
        return await runOnce(repoPath, args, opts)
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        if (!isLockError(lastError.message) || attempt === LOCK_RETRY_DELAYS.length) throw lastError
        await sleep(LOCK_RETRY_DELAYS[attempt])
      }
    }
    throw lastError ?? new Error('git command failed')
  })
}

/**
 * Run a non-mutating git command from this module (stash list, worktree list,
 * …) WITHOUT the write queue. Reads never take the index lock, and queueing
 * them would make a snapshot refresh wait behind a slow network operation.
 */
function runRead(repoPath: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return runOnce(repoPath, args, opts)
}

/** Dev-only: name any git command that takes noticeable time. */
const PERF = process.env.NODE_ENV !== 'production' || process.env.GITGROVE_PERF === '1'

async function runOnce(repoPath: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const bin = await locateGit()
  const startedAt = PERF ? performance.now() : 0
  const logSlow = () => {
    if (!PERF) return
    const elapsed = performance.now() - startedAt
    if (elapsed > 300) {
      console.log(`[git] slow: git ${args.slice(0, 3).join(' ')} ${elapsed.toFixed(0)}ms`)
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: repoPath,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderr += text
      if (opts.onProgress) parseProgressText(text, opts.onProgress)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      logSlow()
      if (code === 0 || (code !== null && opts.tolerateExitCodes?.includes(code))) {
        resolve(stdout)
      } else {
        // With --progress the failure reason shares stderr with hundreds of
        // in-place percent updates; drop those so the toast shows the reason.
        const reason = opts.onProgress
          ? stderr
              .split(/[\r\n]/)
              .filter((l) => l.trim() && !/\d+%/.test(l))
              .join('\n')
          : stderr
        reject(new Error(reason.trim() || stdout.trim() || `git ${args[0]} failed (${code})`))
      }
    })
    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
  })
}

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

// ── Sync: fetch / pull / push ───────────────────────────────────────────────

export async function getSyncStatus(repoPath: string): Promise<SyncStatus> {
  const remotes = (await run(repoPath, ['remote']).catch(() => ''))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)

  let upstream: string | null = null
  try {
    upstream =
      (await run(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim() ||
      null
  } catch {
    upstream = null
  }

  let ahead = 0
  let behind = 0
  if (upstream) {
    try {
      const counts = (
        await run(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
      ).trim()
      const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0)
      behind = b
      ahead = a
    } catch {
      /* counts stay 0 */
    }
  }
  return { upstream, ahead, behind, remotes }
}

export async function fetch(
  repoPath: string,
  remote?: string,
  onProgress?: ProgressHandler
): Promise<void> {
  // Fetch never touches the index, so it must NOT ride the write queue — a
  // slow network fetch would otherwise make a one-file stage wait behind it.
  const args = ['fetch', '--prune', '--progress']
  if (remote) args.push(remote)
  await runOnce(repoPath, args, { onProgress })
}

export async function pull(
  repoPath: string,
  opts: { rebase?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['-c', 'core.editor=true', 'pull', '--progress']
  if (opts.rebase) args.push('--rebase')
  await run(repoPath, args, { onProgress })
}

export async function push(
  repoPath: string,
  opts: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  // Push reads refs and talks to the network — no index lock; keep it off the
  // write queue for the same reason as fetch.
  const args = ['push', '--progress']
  if (opts.forceWithLease) args.push('--force-with-lease')
  if (opts.setUpstream) args.push('-u', opts.setUpstream.remote, opts.setUpstream.branch)
  await runOnce(repoPath, args, { onProgress })
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

/**
 * Detect an in-progress merge/rebase/cherry-pick/revert by probing the state
 * files inside the git dir. `rev-parse --git-path` resolves them correctly
 * even from a linked worktree.
 */
export async function getRepoState(repoPath: string): Promise<RepoState> {
  // `--git-path` resolves state files correctly even from a linked worktree;
  // it returns a path relative to the cwd (or absolute) — make it absolute.
  const gitPath = async (rel: string): Promise<string> => {
    const p = (await run(repoPath, ['rev-parse', '--git-path', rel])).trim()
    return isAbsolute(p) ? p : join(repoPath, p)
  }
  const probe = async (rel: string): Promise<boolean> => {
    try {
      await access(await gitPath(rel))
      return true
    } catch {
      return false
    }
  }

  let op: RepoOpKind | null = null
  if ((await probe('rebase-merge')) || (await probe('rebase-apply'))) op = 'rebasing'
  else if (await probe('MERGE_HEAD')) op = 'merging'
  else if (await probe('CHERRY_PICK_HEAD')) op = 'cherry-picking'
  else if (await probe('REVERT_HEAD')) op = 'reverting'

  let conflictedCount = 0
  if (op) {
    const out = await run(repoPath, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    conflictedCount = out.split('\n').filter((l) => l.trim()).length
  }

  let detail: string | undefined
  if (op === 'merging') {
    // First line of MERGE_MSG: `Merge branch 'feature'` — good enough to show.
    try {
      detail = (await readFile(await gitPath('MERGE_MSG'), 'utf8')).split('\n')[0]
    } catch {
      /* optional */
    }
  }

  return { op, detail, conflictedCount }
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

// ── Interactive rebase ──────────────────────────────────────────────────────

/**
 * The message-editor invocations git will make for a todo list, in order:
 * one per `reword`, and one at the end of each squash chain (fixups don't
 * prompt). `null` means "keep git's prepared message". Exported for tests.
 */
export function buildEditorQueue(items: RebaseTodoItem[]): (string | null)[] {
  const queue: (string | null)[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.action === 'reword') {
      queue.push(item.message?.trim() ? item.message : null)
    } else if (item.action === 'squash') {
      // Git prompts once per squash *step*. A chain of N squashes prompts N
      // times; we only override the last prompt (the chain's final message).
      const isChainEnd = items[i + 1]?.action !== 'squash'
      queue.push(isChainEnd && item.message?.trim() ? item.message : null)
    }
  }
  return queue
}

/** Render the todo file. Items arrive oldest-first, matching git's order. */
export function buildTodoFile(items: RebaseTodoItem[]): string {
  return `${items
    .filter((i) => i.action !== 'drop')
    .map((i) => `${i.action} ${i.hash}`)
    .join('\n')}\n`
}

/**
 * Run a fully scripted `git rebase -i`: our todo replaces git's, and a tiny
 * sh editor feeds prepared messages for reword/squash prompts (sh ships with
 * git on every platform, including Git for Windows). On conflict the rebase
 * stops normally and the app's conflict banner takes over (continue/abort).
 */
export async function rebaseInteractive(
  repoPath: string,
  base: string,
  items: RebaseTodoItem[]
): Promise<void> {
  if (items.length === 0 || items.every((i) => i.action === 'drop')) {
    throw new Error('Nothing to rebase: every commit would be dropped.')
  }
  if (items[0].action === 'squash' || items[0].action === 'fixup') {
    throw new Error('The first commit cannot be squashed — there is nothing above it.')
  }

  const dir = await mkdtemp(join(tmpdir(), 'gitgrove-rebase-'))
  try {
    await writeFile(join(dir, 'todo'), buildTodoFile(items), 'utf8')

    const queue = buildEditorQueue(items)
    await Promise.all(
      queue.map((msg, i) =>
        msg !== null ? writeFile(join(dir, `msg-${i + 1}.txt`), msg, 'utf8') : Promise.resolve()
      )
    )

    // Sequence editor: overwrite git's todo with ours. Message editor: pop the
    // next prepared message if one exists, else keep git's default. Both run
    // under git's sh, so forward slashes work everywhere.
    const posixDir = dir.replace(/\\/g, '/')
    await writeFile(
      join(dir, 'seq-editor.sh'),
      `#!/bin/sh\ncat "${posixDir}/todo" > "$1"\n`,
      'utf8'
    )
    await writeFile(
      join(dir, 'msg-editor.sh'),
      [
        '#!/bin/sh',
        `d="${posixDir}"`,
        'n=$(cat "$d/count" 2>/dev/null || echo 0)',
        'n=$((n+1))',
        'echo "$n" > "$d/count"',
        'if [ -f "$d/msg-$n.txt" ]; then cat "$d/msg-$n.txt" > "$1"; fi',
        'exit 0',
        ''
      ].join('\n'),
      'utf8'
    )

    await run(repoPath, ['-c', 'rebase.autoSquash=false', 'rebase', '-i', base], {
      env: {
        GIT_SEQUENCE_EDITOR: `sh "${posixDir}/seq-editor.sh"`,
        GIT_EDITOR: `sh "${posixDir}/msg-editor.sh"`
      }
    })
  } finally {
    // A stopped (conflicted) rebase no longer needs the scripts — git only
    // reads the sequence/message editors while the command itself runs; on
    // `rebase --continue` we pass core.editor=true instead.
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
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

// ── Clone ───────────────────────────────────────────────────────────────────

/**
 * Clone with progress. git reports progress on stderr as lines like
 * "Receiving objects:  42% (1234/2934)"; we forward phase + percent to the
 * caller. Resolves with the path of the new repo.
 */
export async function clone(
  url: string,
  parentDir: string,
  onProgress: (phase: string, percent: number) => void
): Promise<string> {
  const name = (url.split('/').pop() ?? 'repository').replace(/\.git$/, '') || 'repository'
  const dest = join(parentDir, name)
  const bin = await locateGit()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['clone', '--progress', '--recurse-submodules', url, dest], {
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    let stderrTail = ''
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderrTail = (stderrTail + text).slice(-4000)
      parseProgressText(text, onProgress)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        // The tail of stderr holds the human-readable failure (auth, 404, …).
        const lines = stderrTail.split('\n').filter((l) => l.trim() && !/\d+%/.test(l))
        reject(new Error(lines.slice(-3).join('\n') || 'git clone failed'))
      }
    })
  })
  return dest
}
