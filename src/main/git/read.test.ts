import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  countConflictMarkers,
  getBranches,
  getCommitFiles,
  getConflictSides,
  getLog,
  getMergePreview,
  getMergeToolName,
  getRemoteWebUrl,
  parseMergeTreeNames,
  parseRecentBranches,
  resolveRepoRoot,
  toWebUrl
} from './read'

// Integration tests: drive the real `git` binary against a throwaway repo so we
// exercise the same code path the app uses. CI runners ship git; if it's ever
// missing these will fail loudly rather than silently skip.

let repo: string
let firstHash: string
let secondHash: string
let renameHash: string

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'author@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'author@example.com'
    }
  }).trim()
}

// Isolate git from the developer's machine config so these tests are hermetic:
// without this, an actual `merge.tool` in the user's global config leaks into
// getMergeToolName. Point global + system config at an empty file (cross-platform
// — `/dev/null` isn't valid on Windows CI). Both the `git()` helper and the
// product code under test inherit this via process.env.
let configHome: string

beforeAll(() => {
  configHome = mkdtempSync(join(tmpdir(), 'gitgrove-config-'))
  const emptyConfig = join(configHome, 'gitconfig')
  writeFileSync(emptyConfig, '')
  process.env.GIT_CONFIG_GLOBAL = emptyConfig
  process.env.GIT_CONFIG_SYSTEM = emptyConfig

  repo = mkdtempSync(join(tmpdir(), 'gitgrove-test-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'commit.gpgsign', 'false'])

  writeFileSync(join(repo, 'README.md'), '# hello\n')
  writeFileSync(join(repo, 'keep.txt'), 'one\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'initial commit'])
  firstHash = git(['rev-parse', 'HEAD'])

  // Second commit: modify a file and add a new one, so getCommitFiles has
  // something with a couple of distinct statuses to report.
  writeFileSync(join(repo, 'keep.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'added.txt'), 'new\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'second commit'])
  secondHash = git(['rev-parse', 'HEAD'])

  // Third commit: a rename plus a non-ASCII filename — both break parsers that
  // read git's quoted, tab-separated output instead of `-z` NUL records.
  git(['mv', 'added.txt', 'moved.txt'])
  writeFileSync(join(repo, 'ümläut ñ.txt'), 'unicode\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'rename and unicode'])
  renameHash = git(['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(configHome, { recursive: true, force: true })
  delete process.env.GIT_CONFIG_GLOBAL
  delete process.env.GIT_CONFIG_SYSTEM
})

describe('resolveRepoRoot', () => {
  it('resolves the top-level dir from a nested path', async () => {
    const root = await resolveRepoRoot(repo)
    // macOS tmpdir is symlinked (/var → /private/var); compare basenames.
    expect(root).not.toBeNull()
    expect(git(['rev-parse', '--show-toplevel'])).toBe(root!)
  })

  it('returns null outside a repo', async () => {
    expect(await resolveRepoRoot(tmpdir())).toBeNull()
  })
})

describe('getBranches', () => {
  it('reports the current branch', async () => {
    const branches = await getBranches(repo)
    expect(branches.current).toBe('main')
    expect(branches.detached).toBe(false)
    expect(branches.local).toContain('main')
  })

  it('resolves the default branch and recent checkouts', async () => {
    // Bounce through two branches so the reflog records the checkouts; end on
    // main so the other tests keep seeing the expected HEAD.
    git(['checkout', '-q', '-b', 'feature/recent-a'])
    git(['checkout', '-q', '-b', 'feature/recent-b'])
    git(['checkout', '-q', 'feature/recent-a'])
    git(['checkout', '-q', 'main'])
    try {
      const branches = await getBranches(repo)
      // No origin/HEAD in a local-only repo — the main/master fallback applies.
      expect(branches.defaultBranch).toBe('main')
      // Most recent checkout first; current (main) and default excluded.
      expect(branches.recent).toEqual(['feature/recent-a', 'feature/recent-b'])
    } finally {
      git(['branch', '-q', '-D', 'feature/recent-a', 'feature/recent-b'])
    }
  })
})

describe('parseRecentBranches', () => {
  // Reflog subjects arrive newest-first, exactly as `reflog --format=%gs`.
  const reflog = [
    'checkout: moving from feature/x to fix/y',
    'commit: change something',
    'checkout: moving from main to feature/x',
    'checkout: moving from feature/x to main',
    'checkout: moving from abc1234 to feature/x',
    'checkout: moving from main to abc1234'
  ].join('\n')

  it('returns checkout targets newest-first, deduplicated', () => {
    const recent = parseRecentBranches(reflog, new Set(['feature/x', 'fix/y', 'main']))
    expect(recent).toEqual(['fix/y', 'feature/x', 'main'])
  })

  it('drops targets that are not candidates (deleted branches, detached hashes)', () => {
    const recent = parseRecentBranches(reflog, new Set(['feature/x']))
    expect(recent).toEqual(['feature/x'])
  })

  it('honours the limit', () => {
    const recent = parseRecentBranches(reflog, new Set(['feature/x', 'fix/y', 'main']), 2)
    expect(recent).toEqual(['fix/y', 'feature/x'])
  })

  it('returns nothing for an empty reflog', () => {
    expect(parseRecentBranches('', new Set(['main']))).toEqual([])
  })
})

describe('getLog', () => {
  it('returns commits newest-first with parsed metadata', async () => {
    const log = await getLog(repo)
    expect(log.length).toBe(3)
    expect(log[0].subject).toBe('rename and unicode')
    expect(log[1].subject).toBe('second commit')
    expect(log[2].subject).toBe('initial commit')
    expect(log[0].authorName).toBe('Test Author')
    expect(log[0].authorEmail).toBe('author@example.com')
    // The root commit has no parents; the others have exactly one.
    expect(log[1].parents).toEqual([firstHash])
    expect(log[2].parents).toEqual([])
  })

  it('honours the limit option', async () => {
    const log = await getLog(repo, { limit: 1 })
    expect(log.length).toBe(1)
    expect(log[0].subject).toBe('rename and unicode')
  })

  it('filters by message with search', async () => {
    const log = await getLog(repo, { search: 'initial' })
    expect(log.map((c) => c.subject)).toEqual(['initial commit'])
  })
})

describe('toWebUrl', () => {
  it('converts scp-like SSH remotes to https', () => {
    expect(toWebUrl('git@github.com:danipen/gitgrove.git')).toBe(
      'https://github.com/danipen/gitgrove'
    )
  })

  it('converts ssh:// remotes, dropping creds and port', () => {
    expect(toWebUrl('ssh://git@github.com:22/danipen/gitgrove.git')).toBe(
      'https://github.com/danipen/gitgrove'
    )
  })

  it('upgrades git:// and http:// to https and strips .git', () => {
    expect(toWebUrl('git://gitlab.com/group/proj.git')).toBe('https://gitlab.com/group/proj')
    expect(toWebUrl('http://example.com/a/b.git')).toBe('https://example.com/a/b')
  })

  it('passes through a clean https remote', () => {
    expect(toWebUrl('https://github.com/danipen/gitgrove.git')).toBe(
      'https://github.com/danipen/gitgrove'
    )
  })

  it('returns null for non-browsable or empty remotes', () => {
    expect(toWebUrl('/srv/git/repo.git')).toBeNull()
    expect(toWebUrl('')).toBeNull()
    expect(toWebUrl('https://github.com')).toBeNull()
  })
})

describe('getRemoteWebUrl', () => {
  it('resolves the origin remote to a web URL', async () => {
    git(['remote', 'add', 'origin', 'git@github.com:danipen/gitgrove.git'])
    try {
      expect(await getRemoteWebUrl(repo)).toBe('https://github.com/danipen/gitgrove')
    } finally {
      git(['remote', 'remove', 'origin'])
    }
  })

  it('returns null when the repo has no remote', async () => {
    expect(await getRemoteWebUrl(repo)).toBeNull()
  })
})

describe('getCommitFiles', () => {
  it('lists files changed in a commit with status and line counts', async () => {
    const files = await getCommitFiles(repo, secondHash)
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
    expect(byPath['added.txt'].status).toBe('added')
    expect(byPath['keep.txt'].status).toBe('modified')
    expect(byPath['keep.txt'].insertions).toBe(1)
    expect(byPath['keep.txt'].deletions).toBe(0)
  })

  it('reports renames with both paths and exact unicode filenames', async () => {
    const files = await getCommitFiles(repo, renameHash)
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
    expect(byPath['moved.txt'].status).toBe('renamed')
    expect(byPath['moved.txt'].oldPath).toBe('added.txt')
    expect(byPath['ümläut ñ.txt'].status).toBe('added')
    expect(byPath['ümläut ñ.txt'].insertions).toBe(1)
  })

  it('treats every file in a root commit as added', async () => {
    const files = await getCommitFiles(repo, firstHash)
    const statuses = new Set(files.map((f) => f.status))
    expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'keep.txt'])
    expect([...statuses]).toEqual(['added'])
  })
})

describe('parseMergeTreeNames', () => {
  it('returns conflicted paths after the tree oid line', () => {
    const out = 'abc123def\nsrc/app.ts\nREADME.md\n'
    expect(parseMergeTreeNames(out)).toEqual(['src/app.ts', 'README.md'])
  })

  it('returns nothing for a clean merge (oid only)', () => {
    expect(parseMergeTreeNames('abc123def\n')).toEqual([])
  })
})

describe('countConflictMarkers', () => {
  it('counts only line-leading <<<<<<< markers', () => {
    const contents = [
      'line',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'text with <<<<<<< inside',
      '<<<<<<< HEAD',
      'more',
      '>>>>>>> feature'
    ].join('\n')
    expect(countConflictMarkers(contents)).toBe(2)
  })

  it('reports zero for resolved content', () => {
    expect(countConflictMarkers('all good\nno markers\n')).toBe(0)
  })
})

describe('merge preview & conflict sides', () => {
  let mergeRepo: string

  // `merge-tree --write-tree` needs git ≥ 2.38; the preview degrades to
  // 'unknown' on older gits, which the last test covers either way.
  const gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8' })
  const [major, minor] = (gitVersion.match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
  const hasMergeTree = major > 2 || (major === 2 && minor >= 38)

  beforeAll(() => {
    mergeRepo = mkdtempSync(join(tmpdir(), 'gitgrove-preview-'))
    git(['init', '-q', '-b', 'main'], mergeRepo)
    git(['config', 'commit.gpgsign', 'false'], mergeRepo)
    writeFileSync(join(mergeRepo, 'shared.txt'), 'base\n')
    git(['add', '.'], mergeRepo)
    git(['commit', '-q', '-m', 'base'], mergeRepo)
    git(['branch', 'past'], mergeRepo)
    // Clean branch: adds an unrelated file.
    git(['checkout', '-q', '-b', 'clean-add'], mergeRepo)
    writeFileSync(join(mergeRepo, 'clean.txt'), 'clean\n')
    git(['add', '.'], mergeRepo)
    git(['commit', '-q', '-m', 'clean add'], mergeRepo)
    // Colliding branch: edits the same line main edits.
    git(['checkout', '-q', '-b', 'collide', 'main'], mergeRepo)
    writeFileSync(join(mergeRepo, 'shared.txt'), 'theirs\n')
    git(['commit', '-q', '-am', 'theirs'], mergeRepo)
    git(['checkout', '-q', 'main'], mergeRepo)
    writeFileSync(join(mergeRepo, 'shared.txt'), 'ours\n')
    git(['commit', '-q', '-am', 'ours'], mergeRepo)
  })

  afterAll(() => {
    rmSync(mergeRepo, { recursive: true, force: true })
  })

  it('reports up-to-date when the branch is already contained', async () => {
    const preview = await getMergePreview(mergeRepo, 'past')
    expect(preview).toEqual({ outcome: 'up-to-date', conflictedPaths: [], commitCount: 0 })
  })

  it.skipIf(!hasMergeTree)('predicts a clean merge without touching the working tree', async () => {
    const preview = await getMergePreview(mergeRepo, 'clean-add')
    expect(preview.outcome).toBe('clean')
    expect(preview.commitCount).toBe(1)
    expect(git(['status', '--porcelain'], mergeRepo)).toBe('')
  })

  it.skipIf(!hasMergeTree)('predicts conflicts and names the files', async () => {
    const preview = await getMergePreview(mergeRepo, 'collide')
    expect(preview.outcome).toBe('conflicts')
    expect(preview.conflictedPaths).toEqual(['shared.txt'])
    expect(git(['status', '--porcelain'], mergeRepo)).toBe('')
  })

  it.skipIf(hasMergeTree)('degrades to unknown on gits without merge-tree', async () => {
    const preview = await getMergePreview(mergeRepo, 'collide')
    expect(preview.outcome).toBe('unknown')
    expect(preview.commitCount).toBe(1)
  })

  it('returns all three versions and the marker count of a live conflict', async () => {
    try {
      git(['merge', 'collide'], mergeRepo)
    } catch {
      /* exits non-zero on conflict — expected */
    }
    const sides = await getConflictSides(mergeRepo, 'shared.txt')
    expect(sides.base).toBe('base\n')
    expect(sides.ours).toBe('ours\n')
    expect(sides.theirs).toBe('theirs\n')
    expect(sides.oursDeleted).toBe(false)
    expect(sides.theirsDeleted).toBe(false)
    expect(sides.binary).toBe(false)
    expect(sides.markerCount).toBe(1)
    git(['merge', '--abort'], mergeRepo)
  })

  it('reads the configured merge tool name, null when unset', async () => {
    expect(await getMergeToolName(mergeRepo)).toBeNull()
    git(['config', 'merge.tool', 'meld'], mergeRepo)
    try {
      expect(await getMergeToolName(mergeRepo)).toBe('meld')
    } finally {
      git(['config', '--unset', 'merge.tool'], mergeRepo)
    }
  })
})
