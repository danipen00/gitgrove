import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGlobalIdentity, getIdentity, setGlobalIdentity, setIdentity } from './identity'

// Integration against the real git binary. The whole point of getIdentity is
// reading the user's global config, so HOME (and friends) are pointed at a
// throwaway directory for the duration — the developer's real identity must
// be invisible to the test and untouched by it. exec.ts snapshots
// process.env per spawn, so mutating it here affects exactly these calls.
const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM'] as const
const savedEnv = new Map<string, string | undefined>()

let home: string
let repo: string

const git = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, env: process.env, stdio: 'pipe' })

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
  home = mkdtempSync(join(tmpdir(), 'gitgrove-identity-'))
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = join(home, '.config')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  repo = join(home, 'repo')
  mkdirSync(repo)
  git(['init', '-q'], repo)
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
})

// One sequential story against the same throwaway HOME, mirroring a fresh
// machine's life: nothing configured → half configured → the dialog saves a
// global identity and the first commit works → a local identity overrides.
describe('identity', () => {
  test('a fresh machine has no identity', async () => {
    expect(await getIdentity(repo)).toEqual({ name: '', email: '', source: 'none' })
  })

  test('a name without an email still counts as none (commit would fail)', async () => {
    git(['config', '--local', 'user.name', 'Only Name'], repo)
    const identity = await getIdentity(repo)
    expect(identity.source).toBe('none')
    expect(identity.name).toBe('Only Name')
    expect(identity.email).toBe('')
    git(['config', '--local', '--unset-all', 'user.name'], repo)
  })

  test('the dialog default path: save globally, then the commit succeeds', async () => {
    await setIdentity(repo, 'Test User', 'test@example.com', 'global')
    expect(await getIdentity(repo)).toEqual({
      name: 'Test User',
      email: 'test@example.com',
      source: 'global'
    })

    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    git(['add', 'a.txt'], repo)
    git(['commit', '-q', '-m', 'first'], repo)
    const author = git(['log', '-1', '--format=%an <%ae>'], repo).toString().trim()
    expect(author).toBe('Test User <test@example.com>')
  })

  test('a local identity overrides and reports source local', async () => {
    await setIdentity(repo, 'Repo User', 'repo@example.com', 'local')
    expect(await getIdentity(repo)).toEqual({
      name: 'Repo User',
      email: 'repo@example.com',
      source: 'local'
    })
  })

  // Settings → Identity edits exactly the global config: local overrides must
  // be invisible to the read and untouched by the write.
  test('the global identity ignores the local override', async () => {
    expect(await getGlobalIdentity()).toEqual({ name: 'Test User', email: 'test@example.com' })
  })

  test('editing the global identity leaves the local override alone', async () => {
    await setGlobalIdentity('New Global', 'global@example.com')
    expect(await getGlobalIdentity()).toEqual({ name: 'New Global', email: 'global@example.com' })
    expect((await getIdentity(repo)).source).toBe('local')
  })
})
