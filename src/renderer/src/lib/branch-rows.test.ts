import { describe, expect, test } from 'bun:test'
import type { BranchInfo } from '@shared/types'
import { buildBranchRows } from './branch-rows'

const branch = (partial: Partial<BranchInfo> = {}): BranchInfo => ({
  current: 'feature/x',
  detached: false,
  local: ['main', 'feature/x', 'feature/y'],
  remote: ['origin/main', 'origin/feature/z'],
  defaultBranch: 'main',
  recent: ['feature/y'],
  ...partial
})

const names = (rows: ReturnType<typeof buildBranchRows>) =>
  rows.map((r) => (r.kind === 'label' ? `[${r.text}]` : r.name))

describe('buildBranchRows', () => {
  test('orders sections default → recent → local → remote, without repeats', () => {
    expect(names(buildBranchRows(branch(), ''))).toEqual([
      '[Default branch]',
      'main',
      '[Recent branches]',
      'feature/y',
      '[Local]',
      'feature/x',
      '[Remote]',
      'origin/main',
      'origin/feature/z'
    ])
  })

  test('marks only the current local branch as current', () => {
    const rows = buildBranchRows(branch(), '')
    const current = rows.filter((r) => r.kind === 'item' && r.current)
    expect(current).toEqual([
      { kind: 'item', key: 'l:feature/x', name: 'feature/x', current: true, local: true }
    ])
  })

  test('filters by substring and drops emptied section labels', () => {
    expect(names(buildBranchRows(branch(), 'feature'))).toEqual([
      '[Recent branches]',
      'feature/y',
      '[Local]',
      'feature/x',
      '[Remote]',
      'origin/feature/z'
    ])
  })

  test('omits the default section when the default branch only exists remotely', () => {
    const rows = buildBranchRows(branch({ defaultBranch: 'main', local: ['feature/x'] }), '')
    expect(names(rows)).not.toContain('[Default branch]')
  })

  test('returns nothing without branch info or matches', () => {
    expect(buildBranchRows(null, '')).toEqual([])
    expect(buildBranchRows(branch(), 'no-such-branch')).toEqual([])
  })
})
