import { describe, expect, test } from 'bun:test'
import { hostFromInput, isGitHubDotCom, normalizeHost, tokenCreationUrl } from './git-hosts'

describe('normalizeHost', () => {
  test('lowercases and trims but keeps a significant port', () => {
    expect(normalizeHost(' GitHub.COM ')).toBe('github.com')
    expect(normalizeHost('ghe.example:8443')).toBe('ghe.example:8443')
  })
})

describe('hostFromInput', () => {
  test('accepts whatever shape a user pastes into a server field', () => {
    expect(hostFromInput('ghe.corp.example')).toBe('ghe.corp.example')
    expect(hostFromInput('https://GHE.corp.example/org/repo')).toBe('ghe.corp.example')
    expect(hostFromInput('http://ghe.corp.example:8443')).toBe('ghe.corp.example:8443')
    expect(hostFromInput('  github.com/torvalds/linux  ')).toBe('github.com')
  })

  test('rejects empty and unparseable input', () => {
    expect(hostFromInput('')).toBeNull()
    expect(hostFromInput('   ')).toBeNull()
    expect(hostFromInput('http://')).toBeNull()
  })
})

describe('isGitHubDotCom', () => {
  test('matches github.com only, in any case', () => {
    expect(isGitHubDotCom('GitHub.com')).toBe(true)
    expect(isGitHubDotCom('ghe.corp.example')).toBe(false)
  })
})

describe('tokenCreationUrl', () => {
  test('pre-fills the scopes a git client needs', () => {
    expect(tokenCreationUrl('ghe.corp.example')).toBe(
      'https://ghe.corp.example/settings/tokens/new?scopes=repo,workflow&description=GitGrove'
    )
  })
})
