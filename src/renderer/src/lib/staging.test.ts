import { describe, expect, test } from 'bun:test'
import {
  buildBlockPatch,
  type DisplayMeta,
  listChangeBlocks
} from './staging'

/** 10-line file with two edits close enough that the differ merges the hunk. */
const META: DisplayMeta = {
  deletionLines: ['one\n', 'two\n', 'three\n', 'four\n', 'five\n', 'six\n', 'seven\n', 'eight\n'],
  additionLines: ['ONE\n', 'two\n', 'three\n', 'FOUR\n', 'five\n', 'six\n', 'seven\n', 'eight\n'],
  hunks: [
    {
      deletionStart: 1,
      deletionCount: 7,
      additionStart: 1,
      additionCount: 7,
      hunkContent: [
        { type: 'change', deletions: 1, deletionLineIndex: 0, additions: 1, additionLineIndex: 0 },
        { type: 'context', lines: 2 },
        { type: 'change', deletions: 1, deletionLineIndex: 3, additions: 1, additionLineIndex: 3 },
        { type: 'context', lines: 3 }
      ]
    }
  ]
}

describe('listChangeBlocks', () => {
  test('one hunk with two change blocks yields two selectable blocks', () => {
    const blocks = listChangeBlocks(META)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ index: 0, oldStart: 1, oldLines: 1, newLines: 1 })
    expect(blocks[1]).toMatchObject({ index: 1, oldStart: 4, oldLines: 1, newLines: 1 })
  })

  test('anchors: first block has no context above; second sits on the line above', () => {
    const blocks = listChangeBlocks(META)
    expect(blocks[0].anchor).toEqual({ side: 'additions', lineNumber: 1 })
    expect(blocks[1].anchor).toEqual({ side: 'additions', lineNumber: 3 })
  })

  test('pure deletion block anchors on the old side when at hunk start', () => {
    const meta: DisplayMeta = {
      deletionLines: ['gone\n', 'a\n'],
      additionLines: ['a\n'],
      hunks: [
        {
          deletionStart: 1,
          deletionCount: 2,
          additionStart: 1,
          additionCount: 1,
          hunkContent: [
            {
              type: 'change',
              deletions: 1,
              deletionLineIndex: 0,
              additions: 0,
              additionLineIndex: 0
            },
            { type: 'context', lines: 1 }
          ]
        }
      ]
    }
    expect(listChangeBlocks(meta)[0].anchor).toEqual({ side: 'deletions', lineNumber: 1 })
  })
})

describe('buildBlockPatch', () => {
  const blocks = listChangeBlocks(META)

  test('renders a standalone patch with context clamped before the neighbor block', () => {
    const patch = buildBlockPatch('f.txt', META, blocks, 0)
    expect(patch).toBe(
      [
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        '-one',
        '+ONE',
        ' two',
        ' three',
        ''
      ].join('\n')
    )
  })

  test('second block takes leading context only up to the previous block', () => {
    const patch = buildBlockPatch('f.txt', META, blocks, 1)
    expect(patch).toContain('@@ -2,6 +2,6 @@')
    expect(patch).toContain('-four')
    expect(patch).toContain('+FOUR')
    // context never includes the other block's changed lines
    expect(patch).not.toContain('-one')
    expect(patch).not.toContain('+ONE')
    expect(patch).not.toContain(' one')
  })

  test('marks a missing trailing newline on the touched side', () => {
    const meta: DisplayMeta = {
      deletionLines: ['a\n', 'b'],
      additionLines: ['a\n', 'B'],
      hunks: [
        {
          deletionStart: 1,
          deletionCount: 2,
          additionStart: 1,
          additionCount: 2,
          hunkContent: [
            { type: 'context', lines: 1 },
            {
              type: 'change',
              deletions: 1,
              deletionLineIndex: 1,
              additions: 1,
              additionLineIndex: 1
            }
          ]
        }
      ]
    }
    const b = listChangeBlocks(meta)
    const patch = buildBlockPatch('x.txt', meta, b, 0)
    expect(patch).toContain('-b\n\\ No newline at end of file')
    expect(patch).toContain('+B\n\\ No newline at end of file')
  })
})
