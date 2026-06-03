import { describe, expect, it } from 'bun:test'
import type { FileStatus } from '@shared/types'
import { parseRefs, pluralize, prettyPath, splitPath, statusLabel, statusLetter } from './format'

describe('splitPath', () => {
  it('splits a nested path into dir prefix and basename', () => {
    expect(splitPath('src/main/git.ts')).toEqual({ dir: 'src/main/', name: 'git.ts' })
  })

  it('returns an empty dir for a top-level file', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })

  it('keeps the trailing slash on the dir prefix', () => {
    expect(splitPath('a/b/')).toEqual({ dir: 'a/b/', name: '' })
  })
})

describe('statusLabel / statusLetter', () => {
  const cases: Array<[FileStatus, string, string]> = [
    ['added', 'Added', 'A'],
    ['modified', 'Modified', 'M'],
    ['deleted', 'Deleted', 'D'],
    ['renamed', 'Renamed', 'R'],
    ['untracked', 'Untracked', 'U'],
    ['ignored', 'Ignored', 'I'],
    ['conflicted', 'Conflicted', 'C']
  ]

  it.each(cases)('%s → label %s / letter %s', (status, label, letter) => {
    expect(statusLabel(status)).toBe(label)
    expect(statusLetter(status)).toBe(letter)
  })
})

describe('pluralize', () => {
  it('keeps the singular form for exactly one', () => {
    expect(pluralize(1, 'file')).toBe('1 file')
  })

  it('appends an s for zero and many', () => {
    expect(pluralize(0, 'file')).toBe('0 files')
    expect(pluralize(3, 'commit')).toBe('3 commits')
  })
})

describe('parseRefs', () => {
  it('returns no refs for an empty decoration', () => {
    expect(parseRefs('')).toEqual([])
  })

  it('strips the HEAD arrow and keeps the branch name', () => {
    expect(parseRefs('HEAD -> main')).toEqual([{ name: 'main', isTag: false }])
  })

  it('marks tag: entries as tags', () => {
    expect(parseRefs('tag: v1.0.0')).toEqual([{ name: 'v1.0.0', isTag: true }])
  })

  it('parses a mixed, comma-separated decoration', () => {
    expect(parseRefs('HEAD -> main, origin/main, tag: v1.2.3')).toEqual([
      { name: 'main', isTag: false },
      { name: 'origin/main', isTag: false },
      { name: 'v1.2.3', isTag: true }
    ])
  })
})

describe('prettyPath', () => {
  it('collapses a macOS home directory to ~', () => {
    expect(prettyPath('/Users/danipen/Projects/gitgrove')).toBe('~/Projects/gitgrove')
  })

  it('collapses a Linux home directory to ~', () => {
    expect(prettyPath('/home/dani/code/app')).toBe('~/code/app')
  })

  it('leaves other absolute paths unchanged', () => {
    expect(prettyPath('/opt/tools/bin')).toBe('/opt/tools/bin')
  })
})
