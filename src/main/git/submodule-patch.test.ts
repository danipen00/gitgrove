import { describe, expect, test } from 'bun:test'
import { describeSubmodulePatch } from './submodule-patch'

const OLD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function gitlinkPatch(body: string[]): string {
  return [
    'diff --git a/libs/engine b/libs/engine',
    'index aaaaaaa..bbbbbbb 160000',
    '--- a/libs/engine',
    '+++ b/libs/engine',
    '@@ -1 +1 @@',
    ...body,
    ''
  ].join('\n')
}

describe('describeSubmodulePatch', () => {
  test('moved submodule: both shas', () => {
    const patch = gitlinkPatch([`-Subproject commit ${OLD}`, `+Subproject commit ${NEW}`])
    expect(describeSubmodulePatch(patch)).toEqual({ oldSha: OLD, newSha: NEW, dirty: false })
  })

  test('dirty working tree carries through', () => {
    const patch = gitlinkPatch([`-Subproject commit ${OLD}`, `+Subproject commit ${NEW}-dirty`])
    expect(describeSubmodulePatch(patch)).toEqual({ oldSha: OLD, newSha: NEW, dirty: true })
  })

  test('added submodule: old side absent', () => {
    const patch = gitlinkPatch([`+Subproject commit ${NEW}`])
    expect(describeSubmodulePatch(patch)).toEqual({ oldSha: null, newSha: NEW, dirty: false })
  })

  test('removed submodule: new side absent', () => {
    const patch = gitlinkPatch([`-Subproject commit ${OLD}`])
    expect(describeSubmodulePatch(patch)).toEqual({ oldSha: OLD, newSha: null, dirty: false })
  })

  test('file content mentioning Subproject commit is not a gitlink', () => {
    // A real file edit always has more than the two gitlink lines — any
    // non-matching changed line or any context line disqualifies the patch.
    const withContext = [
      'diff --git a/notes.md b/notes.md',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,2 +1,2 @@',
      ' some context',
      `-Subproject commit ${OLD}`,
      `+Subproject commit ${NEW}`,
      ''
    ].join('\n')
    expect(describeSubmodulePatch(withContext)).toBeNull()
    const extraChange = gitlinkPatch([
      `-Subproject commit ${OLD}`,
      '-and another deleted line',
      `+Subproject commit ${NEW}`
    ])
    expect(describeSubmodulePatch(extraChange)).toBeNull()
  })

  test('ordinary patches return null fast', () => {
    expect(describeSubmodulePatch('')).toBeNull()
    expect(describeSubmodulePatch(gitlinkPatch(['-old line', '+new line']))).toBeNull()
  })
})
