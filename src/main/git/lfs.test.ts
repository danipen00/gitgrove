import { describe, expect, test } from 'bun:test'
import { attributesUseLfs } from './lfs'

describe('attributesUseLfs', () => {
  test('detects the standard git lfs track line', () => {
    expect(attributesUseLfs('*.psd filter=lfs diff=lfs merge=lfs -text\n')).toBe(true)
  })

  test('detects filter=lfs in any attribute position', () => {
    expect(attributesUseLfs('*.bin -text filter=lfs')).toBe(true)
    expect(attributesUseLfs('assets/** filter=lfs')).toBe(true)
  })

  test('ignores other filters and lookalike values', () => {
    expect(attributesUseLfs('*.c filter=indent\n')).toBe(false)
    expect(attributesUseLfs('*.bin filter=lfs2\n')).toBe(false)
    expect(attributesUseLfs('*.bin myfilter=lfs\n')).toBe(false)
  })

  test('ignores comments and plain attribute files', () => {
    expect(attributesUseLfs('# *.psd filter=lfs\n*.txt text\n')).toBe(false)
    expect(attributesUseLfs('*.sh eol=lf\n*.bat eol=crlf\n')).toBe(false)
    expect(attributesUseLfs('')).toBe(false)
  })
})
