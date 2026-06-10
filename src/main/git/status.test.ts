import { describe, expect, test } from 'bun:test'
import { parsePorcelainV2 } from './status'

const NUL = '\0'

function rec(...records: string[]): string {
  return records.join(NUL) + NUL
}

describe('parsePorcelainV2', () => {
  test('parses branch headers including ahead/behind', () => {
    const out = rec(
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +3 -2'
    )
    const { headers } = parsePorcelainV2(out)
    expect(headers).toEqual({
      branch: 'main',
      oid: '1234567890abcdef1234567890abcdef12345678',
      upstream: 'origin/main',
      ahead: 3,
      behind: 2
    })
  })

  test('detached HEAD and unborn branch', () => {
    const detached = parsePorcelainV2(rec('# branch.oid abcdef1', '# branch.head (detached)'))
    expect(detached.headers.branch).toBeNull()
    expect(detached.headers.oid).toBe('abcdef1')
    const unborn = parsePorcelainV2(rec('# branch.oid (initial)', '# branch.head main'))
    expect(unborn.headers.oid).toBe('')
  })

  test('ordinary entries map staged/unstaged sides', () => {
    const out = rec(
      '1 M. N... 100644 100644 100644 aaa bbb staged only.txt',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged.txt',
      '1 MM N... 100644 100644 100644 aaa bbb both.txt',
      '1 A. N... 000000 100644 100644 000 bbb added.txt',
      '1 .D N... 100644 100644 000000 aaa bbb deleted.txt'
    )
    const { files } = parsePorcelainV2(out)
    expect(files).toHaveLength(5)
    // Paths with spaces survive (porcelain v2 -z does not quote them).
    expect(files[0]).toMatchObject({
      path: 'staged only.txt',
      staged: true,
      indexStatus: 'modified',
      workingStatus: undefined
    })
    expect(files[1]).toMatchObject({ staged: false, workingStatus: 'modified' })
    expect(files[2]).toMatchObject({ staged: true, partiallyStaged: true })
    expect(files[3]).toMatchObject({ status: 'added', indexStatus: 'added' })
    expect(files[4]).toMatchObject({ status: 'deleted', workingStatus: 'deleted' })
  })

  test('renames carry the original path from the extra record', () => {
    const out = rec(
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      '? next.txt'
    )
    const { files } = parsePorcelainV2(out)
    expect(files[0]).toMatchObject({
      path: 'new name.txt',
      oldPath: 'old name.txt',
      status: 'renamed',
      staged: true
    })
    expect(files[1]).toMatchObject({ path: 'next.txt', status: 'untracked' })
  })

  test('untracked and unmerged entries', () => {
    const out = rec(
      '? brand new.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted file.txt'
    )
    const { files, conflictedCount } = parsePorcelainV2(out)
    expect(files[0]).toMatchObject({ status: 'untracked', staged: false })
    expect(files[1]).toMatchObject({ path: 'conflicted file.txt', status: 'conflicted' })
    expect(conflictedCount).toBe(1)
  })

  test('handles tens of thousands of entries quickly', () => {
    const records: string[] = ['# branch.head main']
    for (let i = 0; i < 50000; i++) records.push(`? dir/sub/file-${i}.txt`)
    const startedAt = performance.now()
    const { files } = parsePorcelainV2(rec(...records))
    const elapsed = performance.now() - startedAt
    expect(files).toHaveLength(50000)
    expect(elapsed).toBeLessThan(500)
  })
})
