import { describe, expect, test } from 'bun:test'
import type { RebaseTodoItem } from '@shared/types'
import {
  buildEditorQueue,
  buildTodoFile,
  parseStashList,
  parseSubmodules,
  parseWorktrees
} from './git-write'

describe('parseStashList', () => {
  test('parses indexes, strips WIP prefixes, keeps dates', () => {
    // `git stash list -z --format=%gd%x00%H%x00%gs%x00%cr`: a flat NUL stream,
    // each record NUL-terminated (so the output ends with a NUL too).
    const out = [
      'stash@{0}\x00aaa111\x00WIP on main: 1234abc Fix the thing\x002 hours ago\x00',
      'stash@{1}\x00bbb222\x00On feature/x: my named stash\x003 days ago\x00'
    ].join('')
    const entries = parseStashList(out)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      index: 0,
      sha: 'aaa111',
      message: '1234abc Fix the thing',
      relativeDate: '2 hours ago'
    })
    expect(entries[1].index).toBe(1)
    expect(entries[1].message).toBe('my named stash')
  })

  test('survives messages containing the old field separators', () => {
    const out = 'stash@{0}\0ccc333\0On main: weird \x1f\x1e chars\0just now\0'
    expect(parseStashList(out)[0].message).toBe('weird \x1f\x1e chars')
  })

  test('ignores malformed output', () => {
    expect(parseStashList('garbage\n\n')).toHaveLength(0)
    expect(parseStashList('')).toHaveLength(0)
  })
})

describe('parseWorktrees', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD 1234567890abcdef',
    'branch refs/heads/main',
    '',
    'worktree /repo-feature',
    'HEAD fedcba0987654321',
    'branch refs/heads/feature/x',
    '',
    'worktree /repo-detached',
    'HEAD aaaa567890abcdef',
    'detached',
    ''
  ].join('\n')

  test('parses paths, branches and flags', () => {
    const wts = parseWorktrees(porcelain, '/repo-feature')
    expect(wts).toHaveLength(3)
    expect(wts[0]).toMatchObject({ path: '/repo', branch: 'main', isMain: true, isCurrent: false })
    expect(wts[1]).toMatchObject({ path: '/repo-feature', branch: 'feature/x', isCurrent: true })
    expect(wts[2].branch).toBeNull()
    expect(wts[2].headShort).toBe('aaaa567')
  })
})

describe('parseSubmodules', () => {
  test('maps status flags to states', () => {
    const out = [
      ' 1234567890abcdef1234567890abcdef12345678 libs/clean (v1.0)',
      '+abcdef1234567890abcdef1234567890abcdef12 libs/dirty (heads/main)',
      '-0000000000000000000000000000000000000000 libs/uninit',
      'Udeadbeefdeadbeefdeadbeefdeadbeefdeadbeef libs/conflicted (broken)',
      ''
    ].join('\n')
    const mods = parseSubmodules(out)
    expect(mods).toHaveLength(4)
    expect(mods[0]).toMatchObject({ path: 'libs/clean', state: 'clean', shaShort: '1234567' })
    expect(mods[1].state).toBe('modified')
    expect(mods[2].state).toBe('uninitialized')
    expect(mods[3].state).toBe('conflict')
  })
})

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
