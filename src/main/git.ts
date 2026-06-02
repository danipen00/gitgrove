// Git access layer for the main process. Uses `simple-git` for the convenient
// structured commands (status, branches, checkout) and a thin execFile wrapper
// for diff/log where we need exact control over formatting and exit codes.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import simpleGit, { type SimpleGit } from 'simple-git'

import type {
  BranchInfo,
  ChangedFile,
  Commit,
  DiffPayload,
  FileStatus,
  LogOptions,
  RepoSummary
} from '@shared/types'

const execFileAsync = promisify(execFile)

/** Git's well-known empty tree object, used to diff root commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Refuse to ship patches larger than this to the renderer (bytes). */
const MAX_PATCH_BYTES = 3 * 1024 * 1024

/**
 * Cap on the combined old+new file contents shipped to enable expandable
 * context. Above this we omit contents and the viewer falls back to the
 * (non-expandable) patch render.
 */
const MAX_CONTENTS_BYTES = 3 * 1024 * 1024

const gitCache = new Map<string, SimpleGit>()

function getGit(repoPath: string): SimpleGit {
  let git = gitCache.get(repoPath)
  if (!git) {
    git = simpleGit({ baseDir: repoPath, maxConcurrentProcesses: 6 })
    gitCache.set(repoPath, git)
  }
  return git
}

/**
 * Run a raw git command, returning stdout regardless of exit code when the code
 * is in `tolerateExitCodes` (git diff family uses code 1 to mean "differences
 * found", which is not an error for us).
 */
async function runGit(
  repoPath: string,
  args: string[],
  tolerateExitCodes: number[] = []
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true
    })
    return stdout
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    if (typeof e.code === 'number' && tolerateExitCodes.includes(e.code)) {
      return e.stdout ?? ''
    }
    throw new Error(e.stderr?.trim() || e.message || 'git command failed')
  }
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    return await getGit(repoPath).checkIsRepo()
  } catch {
    return false
  }
}

/** Resolve the top-level working directory for any path inside a repo. */
export async function resolveRepoRoot(somePath: string): Promise<string | null> {
  try {
    const out = await runGit(somePath, ['rev-parse', '--show-toplevel'])
    const root = out.trim()
    return root || null
  } catch {
    return null
  }
}

function mapStatusCode(index: string, working: string): FileStatus {
  if (index === '?' || working === '?') return 'untracked'
  if (index === '!' || working === '!') return 'ignored'
  if (
    index === 'U' ||
    working === 'U' ||
    (index === 'A' && working === 'A') ||
    (index === 'D' && working === 'D')
  ) {
    return 'conflicted'
  }
  if (index === 'R' || working === 'R') return 'renamed'
  if (index === 'C' || working === 'C') return 'added'
  if (index === 'A' || working === 'A') return 'added'
  if (index === 'D' || working === 'D') return 'deleted'
  return 'modified'
}

export async function getBranches(repoPath: string): Promise<BranchInfo> {
  const git = getGit(repoPath)
  // Enumerating local and remote branches are independent git invocations;
  // run them together so a repo with many remote refs (e.g. unity) isn't
  // billed for both serially.
  const [local, remote] = await Promise.all([
    git.branchLocal(),
    git
      .branch(['-r'])
      .then((raw) => Object.keys(raw.branches).filter((name) => !name.includes('->')))
      .catch(() => [] as string[])
  ])
  return {
    current: local.current,
    detached: local.detached,
    local: local.all,
    remote
  }
}

/**
 * A repo summary cheap enough to return synchronously on open: just the current
 * branch (one git call), no branch enumeration and no working-tree status. The
 * renderer uses this to switch repos instantly, then fetches the full branch
 * list and status in the background. Counts are left at zero — they aren't
 * surfaced in the UI.
 */
export async function getQuickSummary(repoPath: string): Promise<RepoSummary> {
  let current = ''
  let detached = false
  // symbolic-ref resolves the branch name on a normal (or unborn) branch and
  // exits 1 when HEAD is detached.
  try {
    current = (await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'], [1])).trim()
  } catch {
    /* fall through to detached handling */
  }
  if (!current) {
    detached = true
    try {
      current = (await runGit(repoPath, ['rev-parse', '--short', 'HEAD'])).trim()
    } catch {
      current = 'HEAD'
    }
  }
  return {
    path: repoPath,
    name: basename(repoPath),
    branch: { current, detached, local: [], remote: [] },
    changeCount: 0,
    ahead: 0,
    behind: 0
  }
}

export async function getStatus(repoPath: string): Promise<ChangedFile[]> {
  const git = getGit(repoPath)
  const status = await git.status()

  // Map "to" path -> "from" path for renames so the tree can show both.
  const renameFrom = new Map<string, string>()
  for (const r of status.renamed) renameFrom.set(r.to, r.from)

  return status.files.map((f) => {
    const index = f.index || ' '
    const working = f.working_dir || ' '
    const mapped = mapStatusCode(index, working)
    const staged = index !== ' ' && index !== '?' && index !== '!'
    const unstaged = working !== ' ' && working !== '?' && working !== '!'
    return {
      path: f.path,
      oldPath: renameFrom.get(f.path),
      status: mapped,
      staged,
      partiallyStaged: staged && unstaged
    }
  })
}

export async function getSummary(repoPath: string): Promise<RepoSummary> {
  const git = getGit(repoPath)
  const [branch, status] = await Promise.all([getBranches(repoPath), git.status()])
  return {
    path: repoPath,
    name: basename(repoPath),
    branch,
    changeCount: status.files.length,
    ahead: status.ahead,
    behind: status.behind
  }
}

export async function checkout(repoPath: string, branch: string): Promise<BranchInfo> {
  await getGit(repoPath).checkout(branch)
  gitCache.delete(repoPath)
  return getBranches(repoPath)
}

const SEP = '\x1f'
const REC = '\x1e'
const LOG_FORMAT = ['%H', '%h', '%s', '%b', '%an', '%ae', '%aI', '%ar', '%D', '%P'].join(SEP) + REC

export async function getLog(repoPath: string, options: LogOptions = {}): Promise<Commit[]> {
  const { ref, limit = 200, skip = 0, search } = options
  const args = ['log', `--pretty=format:${LOG_FORMAT}`, `--max-count=${limit}`]
  if (skip > 0) args.push(`--skip=${skip}`)
  if (search && search.trim()) {
    args.push(`--grep=${search.trim()}`, '-i', '--all-match')
  }
  args.push(ref && ref.trim() ? ref : 'HEAD')

  const out = await runGit(repoPath, args)
  return out
    .split(REC)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [hash, shortHash, subject, body, authorName, authorEmail, date, relativeDate, refs, parents] =
        rec.split(SEP)
      return {
        hash,
        shortHash,
        subject,
        body: (body ?? '').trim(),
        authorName,
        authorEmail,
        date,
        relativeDate,
        refs: refs ?? '',
        parents: (parents ?? '').trim() ? parents.trim().split(' ') : []
      } satisfies Commit
    })
}

function parseStatusLetter(letter: string): FileStatus {
  switch (letter[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'M':
    case 'T':
      return 'modified'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

export async function getCommitFiles(repoPath: string, hash: string): Promise<ChangedFile[]> {
  // name-status gives us per-file status plus rename source/target.
  // `-m --first-parent` makes merge commits report the diff against their
  // first parent (like GitHub Desktop); without it diff-tree emits nothing
  // for merges. It is harmless for non-merge and root commits.
  const nameStatus = await runGit(repoPath, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-M',
    '-r',
    '--root',
    '-m',
    '--first-parent',
    hash
  ])

  // `-m` emits one section per parent, so a file touched against more than one
  // parent of a merge shows up multiple times. Keep only the first occurrence
  // (the first-parent diff) — both because that's the view we want and because a
  // duplicate path makes the file-tree renderer throw.
  const files: ChangedFile[] = []
  const seen = new Set<string>()
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const code = parts[0]
    const status = parseStatusLetter(code)
    let file: ChangedFile | null = null
    if ((code.startsWith('R') || code.startsWith('C')) && parts.length >= 3) {
      file = { path: parts[2], oldPath: parts[1], status, staged: true }
    } else if (parts.length >= 2) {
      file = { path: parts[1], status, staged: true }
    }
    if (file && !seen.has(file.path)) {
      seen.add(file.path)
      files.push(file)
    }
  }

  // Best-effort line counts from numstat, matched on the new path.
  try {
    const numstat = await runGit(repoPath, [
      'diff-tree',
      '--no-commit-id',
      '--numstat',
      '-M',
      '-r',
      '--root',
      '-m',
      '--first-parent',
      hash
    ])
    const counts = new Map<string, { insertions?: number; deletions?: number; binary: boolean }>()
    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue
      const [ins, del, ...rest] = line.split('\t')
      const rawPath = rest.join('\t')
      // Normalise rename notation `old => new` / `dir/{a => b}` to the new path.
      const path = rawPath
        .replace(/.*\{(?:.*) => (.*)\}/, '$1')
        .replace(/^.* => /, '')
      const binary = ins === '-' && del === '-'
      counts.set(path, {
        insertions: binary ? undefined : Number(ins),
        deletions: binary ? undefined : Number(del),
        binary
      })
    }
    for (const f of files) {
      const c = counts.get(f.path)
      if (c) {
        f.insertions = c.insertions
        f.deletions = c.deletions
        f.binary = c.binary
      }
    }
  } catch {
    // counts are optional
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function finalizeDiff(payload: Omit<DiffPayload, 'binary' | 'notice'> & { patch: string }): DiffPayload {
  const { patch } = payload
  const binary = /^Binary files |GIT binary patch/m.test(patch)
  if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
    return {
      ...payload,
      patch: '',
      binary,
      notice: 'This diff is too large to display.'
    }
  }
  if (binary && !patch.includes('@@')) {
    return { ...payload, binary, notice: 'Binary file — no textual diff available.' }
  }
  return { ...payload, binary }
}

/** Read a blob's contents at a ref (`git show <ref>:<path>`); null if absent. */
async function showFile(repoPath: string, ref: string, path: string): Promise<string | null> {
  try {
    return await runGit(repoPath, ['show', `${ref}:${path}`])
  } catch {
    return null
  }
}

/** Read a working-tree file from disk; null if unreadable. */
async function readWorkingFile(repoPath: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(repoPath, path), 'utf8')
  } catch {
    return null
  }
}

/**
 * Attach full old/new contents to a diff payload so the viewer can render an
 * expandable diff. No-ops (returns the payload unchanged) when either side is
 * unreadable or the combined size exceeds the cap.
 */
function withContents(
  payload: DiffPayload,
  oldContents: string | null,
  newContents: string | null
): DiffPayload {
  if (oldContents == null || newContents == null) return payload
  const size = Buffer.byteLength(oldContents, 'utf8') + Buffer.byteLength(newContents, 'utf8')
  if (size > MAX_CONTENTS_BYTES) return payload
  return { ...payload, oldContents, newContents }
}

export async function getWorkingDiff(repoPath: string, file: ChangedFile): Promise<DiffPayload> {
  const base = { path: file.path, oldPath: file.oldPath, status: file.status }
  let patch = ''

  if (file.status === 'untracked') {
    // Untracked files have no index entry; diff against /dev/null. git returns
    // exit code 1 when the files differ, which is expected here.
    patch = await runGit(repoPath, ['diff', '--no-color', '--no-index', '--', '/dev/null', file.path], [1])
  } else {
    // Everything tracked: full working-tree state (staged + unstaged) vs HEAD.
    const args = ['diff', '--no-color', 'HEAD', '--', file.path]
    if (file.oldPath) args.push(file.oldPath)
    patch = await runGit(repoPath, args, [1])
  }

  const payload = finalizeDiff({ ...base, patch })
  if (payload.notice || payload.binary) return payload

  // Working tree (staged + unstaged) vs HEAD, mirroring the patch above.
  let oldContents: string | null
  let newContents: string | null
  switch (file.status) {
    case 'untracked':
    case 'added':
      oldContents = ''
      newContents = await readWorkingFile(repoPath, file.path)
      break
    case 'deleted':
      oldContents = await showFile(repoPath, 'HEAD', file.oldPath ?? file.path)
      newContents = ''
      break
    case 'modified':
    case 'renamed':
      oldContents = await showFile(repoPath, 'HEAD', file.oldPath ?? file.path)
      newContents = await readWorkingFile(repoPath, file.path)
      break
    default:
      // conflicted / ignored: leave non-expandable.
      return payload
  }

  return withContents(payload, oldContents, newContents)
}

export async function getCommitDiff(
  repoPath: string,
  hash: string,
  file: ChangedFile
): Promise<DiffPayload> {
  const base = { path: file.path, oldPath: file.oldPath, status: file.status }

  // Detect whether the commit has a parent; root commits diff against the empty tree.
  let hasParent = true
  try {
    await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${hash}^`])
  } catch {
    hasParent = false
  }

  const paths = file.oldPath ? [file.path, file.oldPath] : [file.path]
  const args = hasParent
    ? ['diff', '--no-color', '-M', `${hash}^`, hash, '--', ...paths]
    : ['diff', '--no-color', '-M', EMPTY_TREE, hash, '--', ...paths]

  const patch = await runGit(repoPath, args, [1])
  const payload = finalizeDiff({ ...base, patch })
  if (payload.notice || payload.binary) return payload

  const oldContents =
    file.status === 'added' || !hasParent
      ? ''
      : await showFile(repoPath, `${hash}^`, file.oldPath ?? file.path)
  const newContents = file.status === 'deleted' ? '' : await showFile(repoPath, hash, file.path)

  return withContents(payload, oldContents, newContents)
}

export function forgetRepo(repoPath: string): void {
  gitCache.delete(repoPath)
}
