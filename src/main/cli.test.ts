import { describe, expect, test } from 'bun:test'
import { resolveStartupRepo } from './cli'

const noEnv: NodeJS.ProcessEnv = {}

describe('resolveStartupRepo', () => {
  test('reads --repo=<path>', () => {
    expect(resolveStartupRepo(['electron', '.', '--repo=/tmp/sample'], noEnv)).toBe('/tmp/sample')
  })

  test('reads --repo <path> as two tokens', () => {
    expect(resolveStartupRepo(['electron', '--repo', '/tmp/sample'], noEnv)).toBe('/tmp/sample')
  })

  test('falls back to GITGROVE_OPEN_REPO', () => {
    expect(resolveStartupRepo(['electron', '.'], { GITGROVE_OPEN_REPO: '/tmp/env-repo' })).toBe(
      '/tmp/env-repo'
    )
  })

  test('the flag wins over the env var', () => {
    expect(
      resolveStartupRepo(['electron', '--repo=/tmp/flag'], { GITGROVE_OPEN_REPO: '/tmp/env' })
    ).toBe('/tmp/flag')
  })

  test('ignores a bare positional path (Electron owns argv)', () => {
    expect(resolveStartupRepo(['electron', '.', '/tmp/not-a-flag'], noEnv)).toBeNull()
  })

  test('a dangling --repo with no value is ignored', () => {
    expect(resolveStartupRepo(['electron', '--repo'], noEnv)).toBeNull()
    expect(resolveStartupRepo(['electron', '--repo', '--other-flag'], noEnv)).toBeNull()
  })

  test('returns null when nothing requests a repo', () => {
    expect(resolveStartupRepo(['electron', '.'], noEnv)).toBeNull()
    expect(resolveStartupRepo([], { GITGROVE_OPEN_REPO: '  ' })).toBeNull()
  })
})
