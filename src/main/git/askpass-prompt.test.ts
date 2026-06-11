import { describe, expect, test } from 'bun:test'
import { classifyPrompt, friendlyAuthError } from './askpass-prompt'

describe('classifyPrompt', () => {
  test('username prompt with host', () => {
    expect(classifyPrompt("Username for 'https://github.com': ")).toEqual({
      kind: 'username',
      host: 'github.com'
    })
  })

  test('password prompt strips the user@ prefix from the host', () => {
    expect(classifyPrompt("Password for 'https://daniel@github.com': ")).toEqual({
      kind: 'password',
      host: 'github.com'
    })
  })

  test('keeps a non-default port in the host', () => {
    expect(classifyPrompt("Username for 'http://gitea.local:3000': ")).toEqual({
      kind: 'username',
      host: 'gitea.local:3000'
    })
  })

  test('ssh key passphrase prompt', () => {
    expect(classifyPrompt("Enter passphrase for key '/Users/x/.ssh/id_ed25519': ")).toEqual({
      kind: 'passphrase',
      keyPath: '/Users/x/.ssh/id_ed25519'
    })
  })

  test('ssh-add style passphrase prompt (no "key")', () => {
    expect(classifyPrompt("Enter passphrase for '/home/x/.ssh/id_rsa': ")).toEqual({
      kind: 'passphrase',
      keyPath: '/home/x/.ssh/id_rsa'
    })
  })

  test('an unparseable URL still classifies, just without a host', () => {
    expect(classifyPrompt("Username for 'not a url': ")).toEqual({ kind: 'username' })
  })

  test('unknown prompts fall back to a masked password input', () => {
    expect(classifyPrompt('PIN for token: ')).toEqual({ kind: 'password' })
    expect(classifyPrompt('')).toEqual({ kind: 'password' })
  })
})

describe('friendlyAuthError', () => {
  test('a cancelled prompt (askpass exited non-zero) reads as cancelled', () => {
    const stderr =
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
    expect(friendlyAuthError(stderr)).toContain('cancelled')
  })

  test('rejected credentials read as an authentication failure', () => {
    const stderr = "fatal: Authentication failed for 'https://github.com/x/y.git/'"
    expect(friendlyAuthError(stderr)).toContain('Authentication failed')
  })

  test('a rejected ssh key reads as an ssh failure', () => {
    expect(friendlyAuthError('git@github.com: Permission denied (publickey).')).toContain('SSH')
  })

  test('unrelated errors pass through untouched (null)', () => {
    expect(friendlyAuthError('fatal: not a git repository')).toBe(null)
    expect(friendlyAuthError("error: failed to push some refs to 'origin'")).toBe(null)
  })
})
