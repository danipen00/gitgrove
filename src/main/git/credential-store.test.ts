import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rejectStoredCredential } from './credential-store'

// Integration against the real git binary and its stock `store` helper (a
// plain credentials file) — the same erase path osxkeychain/manager take.
// HOME points at a throwaway directory so the developer's real global config
// and helpers are invisible to the test and untouched by it.
const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM'] as const
const savedEnv = new Map<string, string | undefined>()

let home: string
let credsFile: string

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
  home = mkdtempSync(join(tmpdir(), 'gitgrove-credstore-'))
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = join(home, '.config')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  credsFile = join(home, 'git-credentials')
  // git config treats backslashes as escapes, so a raw Windows path
  // (C:\Users\…) in the helper value would be mangled and the store helper
  // would read a different file. git accepts forward slashes on every
  // platform, so normalize the path for the config value (fs calls below still
  // use the native `credsFile`).
  const helperFile = credsFile.replace(/\\/g, '/')
  writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = store --file=${helperFile}\n`)
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
})

describe('rejectStoredCredential', () => {
  test('erases the host from the configured helper, leaving others alone', async () => {
    writeFileSync(
      credsFile,
      'https://user:stale-token@ghe.corp.example\nhttps://other:keep@github.com\n'
    )
    await rejectStoredCredential('ghe.corp.example')
    const left = readFileSync(credsFile, 'utf8')
    expect(left).not.toContain('ghe.corp.example')
    expect(left).toContain('github.com')
  })

  test('a host nobody stored is a quiet no-op', async () => {
    await rejectStoredCredential('nowhere.example')
  })
})
