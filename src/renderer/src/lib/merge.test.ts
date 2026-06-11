import { describe, expect, test } from 'bun:test'
import { conflictActionLabels, mergeSourceFromDetail } from './merge'

describe('mergeSourceFromDetail', () => {
  test('extracts a local branch name', () => {
    expect(mergeSourceFromDetail("Merge branch 'feature/login' into main")).toBe('feature/login')
  })

  test('extracts a remote-tracking branch name', () => {
    expect(mergeSourceFromDetail("Merge remote-tracking branch 'origin/main'")).toBe('origin/main')
  })

  test('extracts a tag name', () => {
    expect(mergeSourceFromDetail("Merge tag 'v2.1.0' into release")).toBe('v2.1.0')
  })

  test('handles branch names containing quotes-adjacent characters', () => {
    expect(mergeSourceFromDetail("Merge branch 'fix/it-s-fine' into dev")).toBe('fix/it-s-fine')
  })

  test('returns null for unrecognizable or missing details', () => {
    expect(mergeSourceFromDetail(undefined)).toBeNull()
    expect(mergeSourceFromDetail('')).toBeNull()
    expect(mergeSourceFromDetail('Revert "something"')).toBeNull()
  })
})

describe('conflictActionLabels', () => {
  test('names the tool and both branches when known', () => {
    const labels = conflictActionLabels({ toolName: 'kdiff3', ours: 'main', theirs: 'feature/x' })
    expect(labels).toEqual({
      tool: 'Resolve in kdiff3',
      ours: 'Resolve Using Ours (main)',
      theirs: 'Resolve Using Theirs (feature/x)',
      mark: 'Mark as Resolved'
    })
  })

  test('drops the parentheses when the branches are unknown', () => {
    const labels = conflictActionLabels({ toolName: null, ours: null, theirs: null })
    expect(labels).toEqual({
      tool: 'Resolve in Merge Tool',
      ours: 'Resolve Using Ours',
      theirs: 'Resolve Using Theirs',
      mark: 'Mark as Resolved'
    })
  })
})
