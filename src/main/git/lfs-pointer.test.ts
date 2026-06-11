import { describe, expect, test } from 'bun:test'
import { describeLfsPatch, parseLfsPointer } from './lfs-pointer'

const OID_A = 'a'.repeat(64)
const OID_B = 'b'.repeat(64)

const pointer = (oid: string, size: number) =>
  `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`

/** A unified patch whose old/new sides are the given line arrays. */
function patchOf(oldLines: string[], newLines: string[]): string {
  const body = [
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`)
  ]
  return [
    'diff --git a/model.bin b/model.bin',
    '--- a/model.bin',
    '+++ b/model.bin',
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...body,
    ''
  ].join('\n')
}

const pointerLines = (oid: string, size: number) => pointer(oid, size).trimEnd().split('\n')

describe('parseLfsPointer', () => {
  test('parses a spec pointer', () => {
    expect(parseLfsPointer(pointer(OID_A, 12345))).toEqual({
      oid: `sha256:${OID_A}`,
      size: 12345
    })
  })

  test('accepts the legacy hawser version URL', () => {
    const text = pointer(OID_A, 7).replace('git-lfs', 'hawser')
    expect(parseLfsPointer(text)).toEqual({ oid: `sha256:${OID_A}`, size: 7 })
  })

  test('accepts extra key-value lines (e.g. extensions)', () => {
    const text = `version https://git-lfs.github.com/spec/v1\next-0-foo sha256:${OID_B}\noid sha256:${OID_A}\nsize 42\n`
    expect(parseLfsPointer(text)).toEqual({ oid: `sha256:${OID_A}`, size: 42 })
  })

  test('rejects ordinary text, even text mentioning the spec URL', () => {
    expect(parseLfsPointer('hello world')).toBeNull()
    expect(parseLfsPointer('')).toBeNull()
    // Version line not first → not a pointer.
    expect(parseLfsPointer(`# docs\nversion https://git-lfs.github.com/spec/v1\n`)).toBeNull()
    // A free-text line after the version breaks the key-value shape.
    expect(
      parseLfsPointer(
        'version https://git-lfs.github.com/spec/v1\nthis is prose, not a pointer\n'
      )
    ).toBeNull()
  })

  test('rejects pointers missing oid or size', () => {
    expect(
      parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${OID_A}\n`)
    ).toBeNull()
    expect(parseLfsPointer('version https://git-lfs.github.com/spec/v1\nsize 5\n')).toBeNull()
  })

  test('rejects oversized contents without parsing them', () => {
    expect(parseLfsPointer(`${pointer(OID_A, 1)}${'x'.repeat(2000)}`)).toBeNull()
  })
})

describe('describeLfsPatch', () => {
  test('modified pointer: both sizes reported', () => {
    const patch = patchOf(pointerLines(OID_A, 1000), pointerLines(OID_B, 2000))
    expect(describeLfsPatch(patch)).toEqual({ oldSize: 1000, newSize: 2000 })
  })

  test('added pointer: old side absent', () => {
    const patch = patchOf([], pointerLines(OID_A, 512))
    expect(describeLfsPatch(patch)).toEqual({ oldSize: null, newSize: 512 })
  })

  test('deleted pointer: new side absent', () => {
    const patch = patchOf(pointerLines(OID_A, 512), [])
    expect(describeLfsPatch(patch)).toEqual({ oldSize: 512, newSize: null })
  })

  test('context lines (unchanged oid, changed size) reconstruct both sides', () => {
    const patch = [
      'diff --git a/model.bin b/model.bin',
      '--- a/model.bin',
      '+++ b/model.bin',
      '@@ -1,3 +1,3 @@',
      ' version https://git-lfs.github.com/spec/v1',
      ` oid sha256:${OID_A}`,
      '-size 100',
      '+size 200',
      ''
    ].join('\n')
    expect(describeLfsPatch(patch)).toEqual({ oldSize: 100, newSize: 200 })
  })

  test('text-to-LFS migration keeps the raw diff (returns null)', () => {
    const patch = patchOf(['real text content', 'more lines'], pointerLines(OID_A, 99))
    expect(describeLfsPatch(patch)).toBeNull()
  })

  test('ordinary patches return null fast', () => {
    expect(describeLfsPatch(patchOf(['old line'], ['new line']))).toBeNull()
    expect(describeLfsPatch('')).toBeNull()
  })

  test('a "no newline at end of file" marker does not break parsing', () => {
    const lines = pointerLines(OID_A, 64)
    const patch = `${patchOf([], lines)}\\ No newline at end of file\n`
    expect(describeLfsPatch(patch)).toEqual({ oldSize: null, newSize: 64 })
  })
})
