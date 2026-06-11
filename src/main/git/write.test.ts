import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendIgnoreEntries,
  commitMerge,
  discardFiles,
  ignorePatterns,
  merge,
  mergeMessage,
  parseStashList,
  parseSubmodules,
  parseWorktrees,
  planDiscard,
  rebase,
  resolveConflict
} from './write'

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
  test('parses indexes, strips WIP prefixes, keeps dates', () => {
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
      relativeDate: '2 hours ago'
    })
    expect(entries[1].index).toBe(1)
    expect(entries[1].message).toBe('my named stash')
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
