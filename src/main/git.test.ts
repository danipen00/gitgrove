import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getBranches, getCommitFiles, getLog, getStatus, isGitRepo, resolveRepoRoot } from './git'

// Integration tests: drive the real `git` binary against a throwaway repo so we
// exercise the same code path the app uses. CI runners ship git; if it's ever
// missing these will fail loudly rather than silently skip.

let repo: string
let firstHash: string

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

beforeAll(() => {
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
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('isGitRepo', () => {
  it('is true inside a repo', async () => {
    expect(await isGitRepo(repo)).toBe(true)
  })

  it('is false for a non-repo directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'gitgrove-plain-'))
    try {
      expect(await isGitRepo(plain)).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
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
})

describe('getLog', () => {
  it('returns commits newest-first with parsed metadata', async () => {
    const log = await getLog(repo)
    expect(log.length).toBe(2)
    expect(log[0].subject).toBe('second commit')
    expect(log[1].subject).toBe('initial commit')
    expect(log[0].authorName).toBe('Test Author')
    expect(log[0].authorEmail).toBe('author@example.com')
    // The root commit has no parents; the tip has exactly one.
    expect(log[0].parents).toEqual([firstHash])
    expect(log[1].parents).toEqual([])
  })

  it('honours the limit option', async () => {
    const log = await getLog(repo, { limit: 1 })
    expect(log.length).toBe(1)
    expect(log[0].subject).toBe('second commit')
  })

  it('filters by message with search', async () => {
    const log = await getLog(repo, { search: 'initial' })
    expect(log.map((c) => c.subject)).toEqual(['initial commit'])
  })
})

describe('getStatus', () => {
  it('reports an untracked working-tree file', async () => {
    writeFileSync(join(repo, 'scratch.txt'), 'tmp\n')
    try {
      const status = await getStatus(repo)
      const scratch = status.find((f) => f.path === 'scratch.txt')
      expect(scratch).toBeDefined()
      expect(scratch!.status).toBe('untracked')
      expect(scratch!.staged).toBe(false)
    } finally {
      rmSync(join(repo, 'scratch.txt'))
    }
  })

  it('is empty for a clean tree', async () => {
    expect(await getStatus(repo)).toEqual([])
  })
})

describe('getCommitFiles', () => {
  it('lists files changed in a commit with their status', async () => {
    const files = await getCommitFiles(repo, 'HEAD')
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.status]))
    expect(byPath['added.txt']).toBe('added')
    expect(byPath['keep.txt']).toBe('modified')
  })

  it('treats every file in a root commit as added', async () => {
    const files = await getCommitFiles(repo, firstHash)
    const statuses = new Set(files.map((f) => f.status))
    expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'keep.txt'])
    expect([...statuses]).toEqual(['added'])
  })
})
