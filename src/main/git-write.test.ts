import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RebaseTodoItem } from '@shared/types'
import {
  appendIgnoreEntries,
  buildEditorQueue,
  buildTodoFile,
  discardFiles,
  ignorePatterns,
  parseProgressText,
  parseStashList,
  parseSubmodules,
  parseWorktrees
} from './git-write'

describe('parseProgressText', () => {
  const collect = (text: string): Array<[string, number]> => {
    const got: Array<[string, number]> = []
    parseProgressText(text, (phase, percent) => got.push([phase, percent]))
    return got
  }

  test('parses \\r-separated in-place updates and remote-prefixed phases', () => {
    const text =
      'remote: Compressing objects:  50% (10/20)\r' +
      'Receiving objects:  42% (1234/2934)\r' +
      'Receiving objects: 100% (2934/2934), done.\n'
    expect(collect(text)).toEqual([
      ['Compressing objects', 50],
      ['Receiving objects', 42],
      ['Receiving objects', 100]
    ])
  })

  test('parses checkout file updates', () => {
    expect(collect('Updating files:  37% (370/1000)\r')).toEqual([['Updating files', 37]])
  })

  test('ignores non-progress chatter', () => {
    const text = 'remote: Enumerating objects: 123, done.\nTo github.com:o/r.git\n   abc..def\n'
    expect(collect(text)).toEqual([])
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

describe('interactive rebase plumbing', () => {
  const items: RebaseTodoItem[] = [
    { hash: 'aaa', action: 'pick' },
    { hash: 'bbb', action: 'reword', message: 'better subject' },
    { hash: 'ccc', action: 'squash' },
    { hash: 'ddd', action: 'squash', message: 'combined message' },
    { hash: 'eee', action: 'fixup' },
    { hash: 'fff', action: 'drop' }
  ]

  test('buildTodoFile omits drops and keeps order', () => {
    expect(buildTodoFile(items)).toBe('pick aaa\nreword bbb\nsquash ccc\nsquash ddd\nfixup eee\n')
  })

  test('buildEditorQueue matches git editor invocations in order', () => {
    // reword bbb → 1 prompt; squash ccc (mid-chain) → 1 prompt kept default;
    // squash ddd (chain end) → 1 prompt with our message; fixup/drop → none.
    expect(buildEditorQueue(items)).toEqual(['better subject', null, 'combined message'])
  })

  test('reword without message keeps the default', () => {
    expect(buildEditorQueue([{ hash: 'x', action: 'reword' }])).toEqual([null])
  })
})
