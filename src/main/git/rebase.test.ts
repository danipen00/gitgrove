import { describe, expect, test } from 'bun:test'
import type { RebaseTodoItem } from '@shared/types'
import { buildEditorQueue, buildTodoFile } from './rebase'

describe('interactive rebase plumbing', () => {
  const items: RebaseTodoItem[] = [
    { hash: 'aaa', action: 'pick' },
    { hash: 'bbb', action: 'reword', message: 'better subject' },
    { hash: 'ccc', action: 'squash' },
    { hash: 'ddd', action: 'squash', message: 'combined message' },
    { hash: 'eee', action: 'fixup' },
    { hash: 'fff', action: 'drop' }
  ]

  test('buildTodoFile omits drops and keeps order', () => {
    expect(buildTodoFile(items)).toBe('pick aaa\nreword bbb\nsquash ccc\nsquash ddd\nfixup eee\n')
  })

  test('buildEditorQueue matches git editor invocations in order', () => {
    // reword bbb → 1 prompt; squash ccc (mid-chain) → 1 prompt kept default;
    // squash ddd (chain end) → 1 prompt with our message; fixup/drop → none.
    expect(buildEditorQueue(items)).toEqual(['better subject', null, 'combined message'])
  })

  test('reword without message keeps the default', () => {
    expect(buildEditorQueue([{ hash: 'x', action: 'reword' }])).toEqual([null])
  })
})
