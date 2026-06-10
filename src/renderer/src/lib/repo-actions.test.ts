import { describe, expect, test } from 'bun:test'

// repo-actions pulls in platform.ts, which reads `window.gitgrove` at module
// load; tests run without a DOM, so provide the minimal global first and
// import dynamically (a static import would be hoisted above the stub).
;(globalThis as { window?: unknown }).window ??= { gitgrove: { platform: 'darwin' } }
const { isGithubUrl, remoteLabel } = await import('./repo-actions')

describe('isGithubUrl', () => {
  test('recognizes github.com URLs', () => {
    expect(isGithubUrl('https://github.com/danipen/gitgrove')).toBe(true)
  })

  test('is false for other hosts and unparsable input', () => {
    expect(isGithubUrl('https://gitlab.com/group/proj')).toBe(false)
    expect(isGithubUrl('not a url')).toBe(false)
    expect(isGithubUrl('')).toBe(false)
  })
})

describe('remoteLabel', () => {
  test('names the known hosts', () => {
    expect(remoteLabel('https://github.com/o/r')).toBe('View on GitHub')
    expect(remoteLabel('https://gitlab.com/o/r')).toBe('View on GitLab')
    expect(remoteLabel('https://bitbucket.org/o/r')).toBe('View on Bitbucket')
    expect(remoteLabel('https://dev.azure.com/o/r')).toBe('View on Azure DevOps')
  })

  test('falls back to a generic label for unknown hosts and bad input', () => {
    expect(remoteLabel('https://git.example.com/o/r')).toBe('Open Remote')
    expect(remoteLabel('not a url')).toBe('Open Remote')
  })
})
