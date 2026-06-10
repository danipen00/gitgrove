import { describe, expect, test } from 'bun:test'
import { escapeIgnorePattern, ignoreOptionsFor, ignoreSelectionOption } from './ignore'

describe('escapeIgnorePattern', () => {
  test('passes ordinary paths through untouched', () => {
    expect(escapeIgnorePattern('src/notes.md')).toBe('src/notes.md')
  })

  test('escapes glob metacharacters so they match literally', () => {
    expect(escapeIgnorePattern('a*b?c[1].txt')).toBe('a\\*b\\?c\\[1\\].txt')
  })

  test('neutralizes a leading comment or negation marker', () => {
    expect(escapeIgnorePattern('#notes.txt')).toBe('\\#notes.txt')
    expect(escapeIgnorePattern('!important.txt')).toBe('\\!important.txt')
  })

  test('keeps trailing spaces, which git would otherwise strip', () => {
    expect(escapeIgnorePattern('weird ')).toBe('weird\\ ')
  })
})

describe('ignoreOptionsFor', () => {
  const untracked = [
    'logs/app.log',
    'logs/db.log',
    'logs/notes.txt',
    'debug.log',
    '.DS_Store',
    'assets/.DS_Store'
  ]

  test('a nested file offers file, extension, and folder options with counts', () => {
    const options = ignoreOptionsFor('logs/app.log', untracked)
    expect(options.map((o) => o.patterns[0])).toEqual(['/logs/app.log', '*.log', '/logs/'])
    expect(options.map((o) => o.label)).toEqual([
      'Ignore File "app.log"',
      'Ignore All .log Files (3)',
      'Ignore Folder "logs" (3)'
    ])
  })

  test('a root-level file offers no folder option', () => {
    const options = ignoreOptionsFor('debug.log', untracked)
    expect(options.map((o) => o.patterns[0])).toEqual(['/debug.log', '*.log'])
  })

  test('an extensionless dotfile offers its exact name, matched anywhere', () => {
    const options = ignoreOptionsFor('.DS_Store', untracked)
    expect(options.map((o) => o.patterns[0])).toEqual(['/.DS_Store', '.DS_Store'])
    expect(options[1].label).toBe('Ignore All .DS_Store Files (2)')
  })

  test('a dotted dotfile (.env.local) is treated by its last extension', () => {
    const options = ignoreOptionsFor('.env.local', ['.env.local'])
    expect(options[1].patterns[0]).toBe('*.local')
  })

  test('an extensionless file offers only itself (and its folder when nested)', () => {
    expect(ignoreOptionsFor('Makefile', untracked).map((o) => o.patterns[0])).toEqual(['/Makefile'])
  })

  test('the count suffix is omitted when a pattern only hides one file', () => {
    const options = ignoreOptionsFor('logs/notes.txt', untracked)
    expect(options[1].label).toBe('Ignore All .txt Files')
  })

  test('folder counts include every untracked file beneath the folder', () => {
    const folder = ignoreOptionsFor('logs/notes.txt', untracked).at(-1)
    expect(folder).toMatchObject({ patterns: ['/logs/'], count: 3 })
  })

  test('special characters are escaped in every pattern kind', () => {
    const options = ignoreOptionsFor('my [wip]/draft*.md', ['my [wip]/draft*.md'])
    expect(options.map((o) => o.patterns[0])).toEqual([
      '/my \\[wip\\]/draft\\*.md',
      '*.md',
      '/my \\[wip\\]/'
    ])
  })
})

describe('ignoreSelectionOption', () => {
  test('all-untracked selection: plain label, one exact pattern per file', () => {
    const option = ignoreSelectionOption(['a.txt', 'b/c.txt'], 2)
    expect(option.label).toBe('Ignore 2 Files')
    expect(option.patterns).toEqual(['/a.txt', '/b/c.txt'])
  })

  test('mixed selection is qualified so the partial effect is explicit', () => {
    expect(ignoreSelectionOption(['a.txt', 'b.txt'], 5).label).toBe('Ignore 2 Untracked Files')
    expect(ignoreSelectionOption(['a.txt'], 3).label).toBe('Ignore Untracked File')
  })
})
