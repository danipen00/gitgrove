import { describe, expect, test } from 'bun:test'
import { parseProgressText } from './exec'

describe('parseProgressText', () => {
  const collect = (text: string): Array<[string, number]> => {
    const got: Array<[string, number]> = []
    parseProgressText(text, (phase, percent) => got.push([phase, percent]))
    return got
  }

  test('parses \\r-separated in-place updates and remote-prefixed phases', () => {
    const text =
      'remote: Compressing objects:  50% (10/20)\r' +
      'Receiving objects:  42% (1234/2934)\r' +
      'Receiving objects: 100% (2934/2934), done.\n'
    expect(collect(text)).toEqual([
      ['Compressing objects', 50],
      ['Receiving objects', 42],
      ['Receiving objects', 100]
    ])
  })

  test('parses checkout file updates', () => {
    expect(collect('Updating files:  37% (370/1000)\r')).toEqual([['Updating files', 37]])
  })

  test('ignores non-progress chatter', () => {
    const text = 'remote: Enumerating objects: 123, done.\nTo github.com:o/r.git\n   abc..def\n'
    expect(collect(text)).toEqual([])
  })
})
