import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTO_STASH_MARKER,
  appendIgnoreEntries,
  checkoutBranch,
  commitMerge,
  createBranch,
  discardFiles,
  ignorePatterns,
  listStashes,
  merge,
  mergeMessage,
  parseStashList,
  parseSubmodules,
  parseWorktrees,
  planDiscard,
  rebase,
  resolveConflict,
  stashApply,
  stashSave
} from './write'

// Isolate git from the machine's config so these integration tests are
// hermetic. Crucially on Windows, Git ships with `core.autocrlf=true` in its
// system config, which would rewrite checked-out LF files to CRLF and break
// the exact-content assertions below (e.g. 'theirs\n' arriving as 'theirs\r\n').
// Point global + system config at an empty file (cross-platform — `/dev/null`
// isn't valid on Windows). Both the test's `git` helpers and the product code
// under test inherit this via process.env.
let configHome: string

beforeAll(() => {
  configHome = mkdtempSync(join(tmpdir(), 'gitgrove-config-'))
  const emptyConfig = join(configHome, 'gitconfig')
  writeFileSync(emptyConfig, '')
  process.env.GIT_CONFIG_GLOBAL = emptyConfig
  process.env.GIT_CONFIG_SYSTEM = emptyConfig
})

afterAll(() => {
  rmSync(configHome, { recursive: true, force: true })
  delete process.env.GIT_CONFIG_GLOBAL
  delete process.env.GIT_CONFIG_SYSTEM
})

describe('planDiscard', () => {
  test('plain modified/deleted files are reset and restored, never trashed', () => {
    const plan = planDiscard([{ path: 'a.txt', status: 'modified' }], [])
    expect(plan).toEqual({ trashPaths: [], resetPaths: ['a.txt'], checkoutPaths: ['a.txt'] })
  })

  test('a staged-new file is trashed and reset, with nothing to restore', () => {
    const plan = planDiscard([{ path: 'new.txt', status: 'added' }], [])
    expect(plan).toEqual({ trashPaths: ['new.txt'], resetPaths: ['new.txt'], checkoutPaths: [] })
  })

  test('a rename forgets both sides, restores the old path, trashes the new', () => {
    const plan = planDiscard([{ path: 'moved.txt', oldPath: 'a.txt', status: 'renamed' }], [])
    expect(plan).toEqual({
      trashPaths: ['moved.txt'],
      resetPaths: ['moved.txt', 'a.txt'],
      checkoutPaths: ['a.txt']
    })
  })

  test('untracked paths only ever go to the trash', () => {
    const plan = planDiscard([], ['junk.tmp', 'scratch/notes.md'])
    expect(plan).toEqual({
      trashPaths: ['junk.tmp', 'scratch/notes.md'],
      resetPaths: [],
      checkoutPaths: []
    })
  })
})

describe('parseStashList', () => {
  test('parses indexes, strips WIP prefixes, keeps dates and branch names', () => {
    // `git stash list -z --format=%gd%x00%H%x00%gs%x00%cr`: a flat NUL stream,
    // each record NUL-terminated (so the output ends with a NUL too).
    const out = [
      'stash@{0}\x00aaa111\x00WIP on main: 1234abc Fix the thing\x002 hours ago\x00',
      'stash@{1}\x00bbb222\x00On feature/x: my named stash\x003 days ago\x00'
    ].join('')
    const entries = parseStashList(out)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      index: 0,
      sha: 'aaa111',
      message: '1234abc Fix the thing',
      branchName: 'main',
      auto: false,
      relativeDate: '2 hours ago'
    })
    expect(entries[1].index).toBe(1)
    expect(entries[1].message).toBe('my named stash')
    expect(entries[1].branchName).toBe('feature/x')
  })

  test('recognizes GitGrove auto-stashes and hides their marker message', () => {
    const out = `stash@{0}\0ddd444\0On topic: ${AUTO_STASH_MARKER}\0just now\0`
    expect(parseStashList(out)[0]).toMatchObject({ auto: true, message: '', branchName: 'topic' })
  })

  test('a user message merely containing the marker is not an auto-stash', () => {
    const out = `stash@{0}\0eee555\0On main: about ${AUTO_STASH_MARKER} stashes\0just now\0`
    expect(parseStashList(out)[0]).toMatchObject({
      auto: false,
      message: `about ${AUTO_STASH_MARKER} stashes`
    })
  })

  test('a detached-HEAD stash has no branch to remember', () => {
    const out = 'stash@{0}\0fff666\0WIP on (no branch): 1234abc Subject\0just now\0'
    expect(parseStashList(out)[0].branchName).toBeNull()
  })

  test('survives messages containing the old field separators', () => {
    const out = 'stash@{0}\0ccc333\0On main: weird \x1f\x1e chars\0just now\0'
    expect(parseStashList(out)[0].message).toBe('weird \x1f\x1e chars')
  })

  test('ignores malformed output', () => {
    expect(parseStashList('garbage\n\n')).toHaveLength(0)
    expect(parseStashList('')).toHaveLength(0)
  })
})

// Integration: drive the real `git` binary against a throwaway repo, like
// git.test.ts does, to pin the discard semantics (HEAD state restored).
describe('discardFiles', () => {
  let repo: string

  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 't@example.com'
      }
    }).trim()

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-discard-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    // Pin line endings so checkout never rewrites LF→CRLF: these tests read the
    // restored file bytes back, and Git for Windows defaults core.autocrlf=true.
    git(['config', 'core.autocrlf', 'false'])
    writeFileSync(join(repo, 'a.txt'), 'original a\n')
    writeFileSync(join(repo, 'b.txt'), 'original b\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('discards a staged rename: old path restored, index forgets the new one', async () => {
    git(['mv', 'a.txt', 'moved.txt'])
    expect(git(['status', '--porcelain'])).toContain('R ')
    // The IPC handler trashes the rename target before the git steps; the
    // tests stand in for the trash with a plain delete.
    rmSync(join(repo, 'moved.txt'))
    await discardFiles(repo, ['moved.txt', 'a.txt'], ['a.txt'])
    expect(git(['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('original a\n')
    expect(existsSync(join(repo, 'moved.txt'))).toBe(false)
  })

  test('discards staged + unstaged edits back to HEAD content', async () => {
    writeFileSync(join(repo, 'b.txt'), 'staged change\n')
    git(['add', 'b.txt'])
    writeFileSync(join(repo, 'b.txt'), 'unstaged change\n')
    await discardFiles(repo, ['b.txt'], ['b.txt'])
    expect(git(['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('original b\n')
  })

  test('discarding a worktree deletion restores the file', async () => {
    rmSync(join(repo, 'b.txt'))
    await discardFiles(repo, ['b.txt'], ['b.txt'])
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('original b\n')
  })

  test('discards a staged-new file (reset only, no checkout)', async () => {
    writeFileSync(join(repo, 'new.txt'), 'brand new\n')
    git(['add', 'new.txt'])
    // Handler trashes the file; the test deletes it, then resets the index.
    rmSync(join(repo, 'new.txt'))
    await discardFiles(repo, ['new.txt'], [])
    expect(git(['status', '--porcelain'])).toBe('')
  })
})

describe('appendIgnoreEntries', () => {
  test('creates content with a trailing newline when the file was empty', () => {
    expect(appendIgnoreEntries('', ['*.log', '/dist/'])).toBe('*.log\n/dist/\n')
  })

  test('appends after existing content, preserving it byte-for-byte', () => {
    expect(appendIgnoreEntries('node_modules/\n', ['*.log'])).toBe('node_modules/\n*.log\n')
  })

  test('mends a missing final newline instead of gluing onto the last line', () => {
    expect(appendIgnoreEntries('node_modules/', ['*.log'])).toBe('node_modules/\n*.log\n')
  })

  test('skips patterns already present (trailing whitespace ignored)', () => {
    expect(appendIgnoreEntries('*.log  \n/dist/\n', ['*.log', '/dist/', '/.env'])).toBe(
      '*.log  \n/dist/\n/.env\n'
    )
  })

  test('returns null when every pattern is already covered', () => {
    expect(appendIgnoreEntries('*.log\n', ['*.log'])).toBeNull()
  })
})

// Integration: a pattern appended through ignorePatterns must actually make
// git stop reporting the file — the whole point of the feature.
describe('ignorePatterns', () => {
  let repo: string

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-ignore-'))
    git(['init', '-q', '-b', 'main'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('creates .gitignore and hides the untracked file from status', async () => {
    writeFileSync(join(repo, 'secret.env'), 'KEY=1\n')
    expect(git(['status', '--porcelain'])).toContain('secret.env')
    await ignorePatterns(repo, ['/secret.env'])
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('/secret.env\n')
    expect(git(['status', '--porcelain'])).not.toContain('secret.env')
  })

  test('appends to the existing .gitignore without duplicating lines', async () => {
    await ignorePatterns(repo, ['/secret.env', '*.log'])
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('/secret.env\n*.log\n')
  })

  test('escaped patterns hide files with glob metacharacters in their name', async () => {
    writeFileSync(join(repo, 'weird [draft].txt'), 'x\n')
    await ignorePatterns(repo, ['/weird \\[draft\\].txt'])
    expect(git(['status', '--porcelain'])).not.toContain('weird')
  })
})

describe('parseWorktrees', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD 1234567890abcdef',
    'branch refs/heads/main',
    '',
    'worktree /repo-feature',
    'HEAD fedcba0987654321',
    'branch refs/heads/feature/x',
    '',
    'worktree /repo-detached',
    'HEAD aaaa567890abcdef',
    'detached',
    ''
  ].join('\n')

  test('parses paths, branches and flags', () => {
    const wts = parseWorktrees(porcelain, '/repo-feature')
    expect(wts).toHaveLength(3)
    expect(wts[0]).toMatchObject({ path: '/repo', branch: 'main', isMain: true, isCurrent: false })
    expect(wts[1]).toMatchObject({ path: '/repo-feature', branch: 'feature/x', isCurrent: true })
    expect(wts[2].branch).toBeNull()
    expect(wts[2].headShort).toBe('aaaa567')
  })
})

describe('parseSubmodules', () => {
  test('maps status flags to states', () => {
    const out = [
      ' 1234567890abcdef1234567890abcdef12345678 libs/clean (v1.0)',
      '+abcdef1234567890abcdef1234567890abcdef12 libs/dirty (heads/main)',
      '-0000000000000000000000000000000000000000 libs/uninit',
      'Udeadbeefdeadbeefdeadbeefdeadbeefdeadbeef libs/conflicted (broken)',
      ''
    ].join('\n')
    const mods = parseSubmodules(out)
    expect(mods).toHaveLength(4)
    expect(mods[0]).toMatchObject({ path: 'libs/clean', state: 'clean', shaShort: '1234567' })
    expect(mods[1].state).toBe('modified')
    expect(mods[2].state).toBe('uninitialized')
    expect(mods[3].state).toBe('conflict')
  })
})

/** Per-suite scratch-repo runner with a pinned committer identity. */
function gitRunner(repo: () => string) {
  return (args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo(),
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 't@example.com'
      }
    }).trim()
}

describe('merge outcomes', () => {
  let repo: string
  const git = gitRunner(() => repo)

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-merge-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    // The library functions spawn git themselves (no env override), so the
    // committer identity must live in the repo config, not just our env.
    git(['config', 'user.name', 'Test'])
    git(['config', 'user.email', 't@example.com'])
    writeFileSync(join(repo, 'shared.txt'), 'base\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
    // A branch already contained in main → merging it is a no-op.
    git(['branch', 'past'])
    // A branch whose change can't collide with main's → merges clean.
    git(['checkout', '-q', '-b', 'clean-add'])
    writeFileSync(join(repo, 'clean.txt'), 'clean\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'add clean file'])
    // Another non-colliding branch, kept for the squash test.
    git(['checkout', '-q', '-b', 'squash-add', 'main'])
    writeFileSync(join(repo, 'squashed.txt'), 'squashed\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'add squashed file'])
    // A branch editing the same line main edits → guaranteed conflict.
    git(['checkout', '-q', '-b', 'collide', 'main'])
    writeFileSync(join(repo, 'shared.txt'), 'theirs\n')
    git(['commit', '-q', '-am', 'theirs edit'])
    git(['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'shared.txt'), 'ours\n')
    git(['commit', '-q', '-am', 'ours edit'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('an already-contained branch reports up-to-date without running merge', async () => {
    expect(await merge(repo, 'past')).toBe('up-to-date')
    expect(git(['status', '--porcelain'])).toBe('')
  })

  test('a non-colliding branch merges to completion', async () => {
    expect(await merge(repo, 'clean-add')).toBe('completed')
    expect(existsSync(join(repo, 'clean.txt'))).toBe(true)
    expect(git(['status', '--porcelain'])).toBe('')
  })

  test('squash stages the result without committing', async () => {
    const before = git(['rev-parse', 'HEAD'])
    expect(await merge(repo, 'squash-add', { squash: true })).toBe('completed')
    expect(git(['rev-parse', 'HEAD'])).toBe(before)
    expect(git(['status', '--porcelain'])).toContain('A  squashed.txt')
    // Leave the tree clean for the next test.
    git(['reset', '-q', '--hard', 'HEAD'])
  })

  test('conflicts come back as data, then resolve + commitMerge concludes the merge', async () => {
    expect(await merge(repo, 'collide')).toBe('conflicts')
    // The merge is parked, not failed: MERGE_HEAD exists and the prepared
    // message is available for the composer.
    expect(git(['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe('')
    expect(await mergeMessage(repo)).toContain("Merge branch 'collide'")
    await resolveConflict(repo, 'shared.txt', 'theirs')
    await commitMerge(repo, 'Merge collide my way')
    expect(git(['log', '-1', '--format=%s'])).toBe('Merge collide my way')
    // Two parents = a real merge commit.
    expect(git(['log', '-1', '--format=%P']).split(' ')).toHaveLength(2)
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('theirs\n')
    expect(git(['status', '--porcelain'])).toBe('')
  })

  test('a genuine failure (dirty tree in the way) still throws', async () => {
    // A fresh colliding branch — 'collide' is already merged by now, so
    // re-merging it would just report up-to-date.
    git(['checkout', '-q', '-b', 'collide2', 'main'])
    writeFileSync(join(repo, 'shared.txt'), 'collide2 edit\n')
    git(['commit', '-q', '-am', 'collide2 edit'])
    git(['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'shared.txt'), 'uncommitted local edit\n')
    await expect(merge(repo, 'collide2')).rejects.toThrow()
    git(['checkout', '-q', '--', 'shared.txt'])
  })
})

describe('resolveConflict on modify/delete conflicts', () => {
  let repo: string
  const git = gitRunner(() => repo)

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-md-conflict-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    // The library functions spawn git themselves (no env override), so the
    // committer identity must live in the repo config, not just our env.
    git(['config', 'user.name', 'Test'])
    git(['config', 'user.email', 't@example.com'])
    writeFileSync(join(repo, 'd.txt'), 'base\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
    git(['checkout', '-q', '-b', 'deleter'])
    git(['rm', '-q', 'd.txt'])
    git(['commit', '-q', '-m', 'delete d'])
    git(['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'd.txt'), 'modified\n')
    git(['commit', '-q', '-am', 'modify d'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('taking the deleting side resolves as a deletion', async () => {
    expect(await merge(repo, 'deleter')).toBe('conflicts')
    // "theirs" deleted the file — checkout --theirs has no version to give,
    // so resolving must fall back to removing it.
    await resolveConflict(repo, 'd.txt', 'theirs')
    expect(git(['ls-files', '-u'])).toBe('')
    expect(existsSync(join(repo, 'd.txt'))).toBe(false)
    git(['merge', '--abort'])
  })

  test('taking the modifying side keeps the file and stages it', async () => {
    expect(await merge(repo, 'deleter')).toBe('conflicts')
    await resolveConflict(repo, 'd.txt', 'ours')
    expect(git(['ls-files', '-u'])).toBe('')
    expect(readFileSync(join(repo, 'd.txt'), 'utf8')).toBe('modified\n')
    git(['merge', '--abort'])
  })
})

describe('rebase outcomes', () => {
  let repo: string
  const git = gitRunner(() => repo)

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-rebase-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    // The library functions spawn git themselves (no env override), so the
    // committer identity must live in the repo config, not just our env.
    git(['config', 'user.name', 'Test'])
    git(['config', 'user.email', 't@example.com'])
    writeFileSync(join(repo, 'r.txt'), 'base\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
    git(['branch', 'past'])
    git(['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'feature work'])
    git(['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'r.txt'), 'main edit\n')
    git(['commit', '-q', '-am', 'main edit'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('rebasing onto an ancestor reports up-to-date', async () => {
    expect(await rebase(repo, 'past')).toBe('up-to-date')
  })

  test('a clean rebase completes and linearizes history', async () => {
    git(['checkout', '-q', 'feature'])
    expect(await rebase(repo, 'main')).toBe('completed')
    // feature's commit now sits on top of main — exactly one parent chain.
    expect(git(['merge-base', 'HEAD', 'main'])).toBe(git(['rev-parse', 'main']))
  })

  test('a colliding rebase parks on conflicts instead of throwing', async () => {
    git(['checkout', '-q', '-b', 'collide', 'main'])
    writeFileSync(join(repo, 'r.txt'), 'collide edit\n')
    git(['commit', '-q', '-am', 'collide edit'])
    git(['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'r.txt'), 'main second edit\n')
    git(['commit', '-q', '-am', 'main second edit'])
    git(['checkout', '-q', 'collide'])
    expect(await rebase(repo, 'main')).toBe('conflicts')
    expect(git(['ls-files', '-u'])).not.toBe('')
    git(['rebase', '--abort'])
  })
})

// Integration: the create-branch stash choreography — leaving changes behind
// (auto-stash that drives the welcome-back reminder) and bringing them along
// (free when git can carry them, ferried via a transient stash when the base
// diverges, parked as conflicts data when the ferry collides). A fresh repo
// per test: every scenario mutates branches, stashes and the working tree.
describe('createBranch with uncommitted changes', () => {
  let repo: string
  const git = gitRunner(() => repo)

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-branch-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    git(['config', 'core.autocrlf', 'false'])
    // The library functions spawn git themselves (no env override), so the
    // committer identity must live in the repo config, not just our env.
    git(['config', 'user.name', 'Test'])
    git(['config', 'user.email', 't@example.com'])
    writeFileSync(join(repo, 'f.txt'), 'line a\nline b\nline c\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  /** A topic branch whose committed f.txt differs from main's, plus a dirty
   *  working-tree edit — the setup where branching from main must ferry. */
  const divergeOnTopic = (dirtyContent: string) => {
    git(['checkout', '-q', '-b', 'topic'])
    writeFileSync(join(repo, 'f.txt'), 'line a\nline b\nline c (topic)\n')
    git(['commit', '-q', '-am', 'topic edit'])
    writeFileSync(join(repo, 'f.txt'), dirtyContent)
  }

  test('leave: changes auto-stash on the source branch, the new branch starts clean', async () => {
    writeFileSync(join(repo, 'f.txt'), 'edited\n')
    writeFileSync(join(repo, 'extra.txt'), 'untracked too\n')
    expect(await createBranch(repo, 'feature', { changes: 'leave' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('feature')
    expect(git(['status', '--porcelain'])).toBe('')
    // The stash is marked as GitGrove's and remembers the branch it belongs
    // to — exactly what the welcome-back reminder keys on.
    const stashes = await listStashes(repo)
    expect(stashes).toHaveLength(1)
    expect(stashes[0]).toMatchObject({ auto: true, branchName: 'main', message: '' })
  })

  test('leave with a clean tree just creates the branch (nothing to stash)', async () => {
    expect(await createBranch(repo, 'feature', { changes: 'leave' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('feature')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('bring: a branch from HEAD carries the tree for free, staged state intact', async () => {
    writeFileSync(join(repo, 'f.txt'), 'staged edit\n')
    git(['add', 'f.txt'])
    writeFileSync(join(repo, 'extra.txt'), 'untracked too\n')
    expect(await createBranch(repo, 'feature', { changes: 'bring' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('feature')
    // No stash round-trip happened — staged stays staged, untracked untouched.
    expect(git(['diff', '--cached', '--name-only'])).toBe('f.txt')
    expect(readFileSync(join(repo, 'extra.txt'), 'utf8')).toBe('untracked too\n')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('bring: a diverging base ferries the changes across via a transient stash', async () => {
    // Dirty edit on a line that's identical in main → the ferry lands cleanly.
    divergeOnTopic('line a (wip)\nline b\nline c (topic)\n')
    expect(await createBranch(repo, 'fresh', { from: 'main', changes: 'bring' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('fresh')
    expect(git(['rev-parse', 'HEAD'])).toBe(git(['rev-parse', 'main'])) // started from main
    // The dirty edit followed; topic's committed edit did not.
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('line a (wip)\nline b\nline c\n')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('bring: a colliding ferry parks as conflicts data, keeping the stash', async () => {
    // Dirty edit on the very line that differs from main → the pop conflicts.
    divergeOnTopic('line a\nline b\nline c (wip)\n')
    expect(await createBranch(repo, 'fresh', { from: 'main', changes: 'bring' })).toBe('conflicts')
    expect(git(['branch', '--show-current'])).toBe('fresh')
    expect(git(['ls-files', '-u'])).not.toBe('')
    expect(await listStashes(repo)).toHaveLength(1)
  })

  test('a dirty diverging base without a changes choice still surfaces the error', async () => {
    divergeOnTopic('line a\nline b\nline c (wip)\n')
    // No `changes` opt (e.g. an op was in flight) — git's refusal must come
    // through, never a silent stash dance the user didn't ask for.
    await expect(createBranch(repo, 'fresh', { from: 'main' })).rejects.toThrow()
    expect(git(['branch', '--show-current'])).toBe('topic')
    expect(await listStashes(repo)).toHaveLength(0)
  })
})

// Integration: the same leave/bring choreography on plain branch switches —
// checkoutBranch shares checkoutWithChanges with createBranch, so these pin
// the switch-specific corners: switching to a branch that already diverges
// and restoring the user's state when the switch itself fails.
describe('checkoutBranch with pending changes', () => {
  let repo: string
  const git = gitRunner(() => repo)

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgrove-switch-'))
    git(['init', '-q', '-b', 'main'])
    git(['config', 'commit.gpgsign', 'false'])
    git(['config', 'core.autocrlf', 'false'])
    // The library functions spawn git themselves (no env override), so the
    // committer identity must live in the repo config, not just our env.
    git(['config', 'user.name', 'Test'])
    git(['config', 'user.email', 't@example.com'])
    writeFileSync(join(repo, 'f.txt'), 'line a\nline b\nline c\n')
    writeFileSync(join(repo, 'g.txt'), 'same everywhere\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])
    // A destination branch whose committed f.txt differs from main's.
    git(['checkout', '-q', '-b', 'other'])
    writeFileSync(join(repo, 'f.txt'), 'line a\nline b\nline c (other)\n')
    git(['commit', '-q', '-am', 'other edit'])
    git(['checkout', '-q', 'main'])
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('leave: changes stay stashed on the source branch, the destination is clean', async () => {
    writeFileSync(join(repo, 'f.txt'), 'line a (wip)\nline b\nline c\n')
    expect(await checkoutBranch(repo, 'other', { changes: 'leave' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('other')
    expect(git(['status', '--porcelain'])).toBe('')
    const stashes = await listStashes(repo)
    expect(stashes).toHaveLength(1)
    expect(stashes[0]).toMatchObject({ auto: true, branchName: 'main', message: '' })
  })

  test('bring: a file identical on both branches just follows (no stash)', async () => {
    writeFileSync(join(repo, 'g.txt'), 'dirty\n')
    expect(await checkoutBranch(repo, 'other', { changes: 'bring' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('other')
    expect(readFileSync(join(repo, 'g.txt'), 'utf8')).toBe('dirty\n')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('bring: a dirty file the destination rewrites ferries across cleanly', async () => {
    // f.txt differs between the branches, so git refuses the direct switch;
    // the dirty line is untouched by `other`, so the ferry lands cleanly.
    writeFileSync(join(repo, 'f.txt'), 'line a (wip)\nline b\nline c\n')
    expect(await checkoutBranch(repo, 'other', { changes: 'bring' })).toBe('completed')
    expect(git(['branch', '--show-current'])).toBe('other')
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('line a (wip)\nline b\nline c (other)\n')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('bring: colliding changes park as conflicts data, keeping the stash', async () => {
    // The dirty edit hits the very line `other` rewrote → the pop conflicts.
    writeFileSync(join(repo, 'f.txt'), 'line a\nline b\nline c (wip)\n')
    expect(await checkoutBranch(repo, 'other', { changes: 'bring' })).toBe('conflicts')
    expect(git(['branch', '--show-current'])).toBe('other')
    expect(git(['ls-files', '-u'])).not.toBe('')
    expect(await listStashes(repo)).toHaveLength(1)
  })

  test('a failed switch restores the stashed changes instead of losing them', async () => {
    writeFileSync(join(repo, 'f.txt'), 'line a (wip)\nline b\nline c\n')
    await expect(checkoutBranch(repo, 'does-not-exist', { changes: 'leave' })).rejects.toThrow()
    // Still on main, still dirty with the same content, nothing left stashed.
    expect(git(['branch', '--show-current'])).toBe('main')
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('line a (wip)\nline b\nline c\n')
    expect(await listStashes(repo)).toHaveLength(0)
  })

  test('applying a stash over clashing changes explains the fix, keeps it', async () => {
    // Stash one edit, make another edit to the same file, then apply: git
    // refuses with "would be overwritten by merge" — the user must get the
    // translated explanation, never the raw git-speak.
    writeFileSync(join(repo, 'f.txt'), 'line a (stashed)\nline b\nline c\n')
    await stashSave(repo, {})
    writeFileSync(join(repo, 'f.txt'), 'line a (newer)\nline b\nline c\n')
    const error = await stashApply(repo, 0, true).then(
      () => null,
      (e: Error) => e
    )
    expect(error?.message).toContain('working tree')
    expect(await listStashes(repo)).toHaveLength(1)
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('line a (newer)\nline b\nline c\n')
  })
})
