import { describe, expect, test } from 'bun:test'
import { splitPatchHunks } from './patch'

const HEADER = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts'
].join('\n')

const TWO_HUNKS = `${HEADER}
@@ -1,3 +1,4 @@
 line one
+added line
 line two
 line three
@@ -10,2 +11,1 @@ function ctx()
 keep
-removed line
`

describe('splitPatchHunks', () => {
  test('splits a two-hunk patch into standalone patches', () => {
    const hunks = splitPatchHunks(TWO_HUNKS)
    expect(hunks).toHaveLength(2)
    // Each mini-patch carries the full file header and exactly one hunk.
    for (const h of hunks) {
      expect(h.patch.startsWith('diff --git a/src/app.ts')).toBe(true)
      expect(h.patch.match(/^@@ /gm)).toHaveLength(1)
      expect(h.patch.endsWith('\n')).toBe(true)
    }
    expect(hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(hunks[0].additions).toBe(1)
    expect(hunks[0].deletions).toBe(0)
    expect(hunks[1].header).toBe('@@ -10,2 +11,1 @@ function ctx()')
    expect(hunks[1].additions).toBe(0)
    expect(hunks[1].deletions).toBe(1)
  })

  test('keeps "no newline" markers inside their hunk', () => {
    const patch = `${HEADER}
@@ -1,1 +1,1 @@
-old
+new
\\ No newline at end of file
`
    const hunks = splitPatchHunks(patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].patch).toContain('\\ No newline at end of file')
  })

  test('returns no hunks for binary patches', () => {
    expect(splitPatchHunks('Binary files a/x.png and b/x.png differ\n')).toHaveLength(0)
  })

  test('returns no hunks for empty or rename-only patches', () => {
    expect(splitPatchHunks('')).toHaveLength(0)
    const renameOnly = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
      ''
    ].join('\n')
    expect(splitPatchHunks(renameOnly)).toHaveLength(0)
  })

  test('counts +/- lines but not header markers', () => {
    const hunks = splitPatchHunks(TWO_HUNKS)
    // `+++` / `---` live in the file header, not inside hunks, so the counts
    // reflect real changes only.
    expect(hunks[0].additions + hunks[1].additions).toBe(1)
    expect(hunks[0].deletions + hunks[1].deletions).toBe(1)
  })
})
