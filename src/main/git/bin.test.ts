import { describe, expect, test } from 'bun:test'
import { delimiter, join } from 'node:path'
import { lfsBinaryLocations, resolveOnPath } from './bin'

describe('lfsBinaryLocations', () => {
  test('darwin prefers Homebrew, then /usr/local, then /usr/bin', () => {
    expect(lfsBinaryLocations('darwin')).toEqual([
      '/opt/homebrew/bin/git-lfs',
      '/usr/local/bin/git-lfs',
      '/usr/bin/git-lfs'
    ])
  })

  test('linux probes the usual bin dirs', () => {
    expect(lfsBinaryLocations('linux')).toEqual([
      '/usr/bin/git-lfs',
      '/usr/local/bin/git-lfs',
      '/bin/git-lfs'
    ])
  })

  test('win32 derives candidates from Program Files', () => {
    const saved = { pf: process.env.ProgramFiles, pf86: process.env['ProgramFiles(x86)'] }
    const pf = 'C:\\Program Files'
    const pf86 = 'C:\\Program Files (x86)'
    process.env.ProgramFiles = pf
    process.env['ProgramFiles(x86)'] = pf86
    try {
      // Build expectations with the same `join` the impl uses so the segment
      // separator matches whatever host runs the test (CI may not be Windows).
      expect(lfsBinaryLocations('win32')).toEqual([
        join(pf, 'Git', 'cmd', 'git-lfs.exe'),
        join(pf, 'Git LFS', 'git-lfs.exe'),
        join(pf86, 'Git', 'cmd', 'git-lfs.exe'),
        join(pf86, 'Git LFS', 'git-lfs.exe')
      ])
    } finally {
      process.env.ProgramFiles = saved.pf
      process.env['ProgramFiles(x86)'] = saved.pf86
    }
  })
})

describe('resolveOnPath', () => {
  /** A fake canRun that succeeds only for the names in `runnable`. */
  const canRunFor = (runnable: string[]) => (bin: string) => Promise.resolve(runnable.includes(bin))

  test('returns the name and leaves PATH untouched when found on PATH', async () => {
    const env = { PATH: `/usr/bin${delimiter}/bin` }
    const found = await resolveOnPath(
      'git-lfs',
      ['/opt/homebrew/bin/git-lfs'],
      canRunFor(['git-lfs']),
      env
    )
    expect(found).toBe('git-lfs')
    expect(env.PATH).toBe(`/usr/bin${delimiter}/bin`)
  })

  test('returns the first matching candidate and prepends its dir to PATH', async () => {
    const env = { PATH: `/usr/bin${delimiter}/bin` }
    const candidates = ['/opt/homebrew/bin/git-lfs', '/usr/local/bin/git-lfs']
    const found = await resolveOnPath('git-lfs', candidates, canRunFor(candidates), env)
    // First runnable candidate wins, even though both are runnable.
    expect(found).toBe('/opt/homebrew/bin/git-lfs')
    expect(env.PATH).toBe(`/opt/homebrew/bin${delimiter}/usr/bin${delimiter}/bin`)
  })

  test('does not duplicate a dir already on PATH', async () => {
    const env = { PATH: `/opt/homebrew/bin${delimiter}/usr/bin` }
    const found = await resolveOnPath(
      'git-lfs',
      ['/opt/homebrew/bin/git-lfs'],
      canRunFor(['/opt/homebrew/bin/git-lfs']),
      env
    )
    expect(found).toBe('/opt/homebrew/bin/git-lfs')
    expect(env.PATH).toBe(`/opt/homebrew/bin${delimiter}/usr/bin`)
  })

  test('returns null when nothing is runnable', async () => {
    const env = { PATH: `/usr/bin${delimiter}/bin` }
    const found = await resolveOnPath('git-lfs', ['/opt/homebrew/bin/git-lfs'], canRunFor([]), env)
    expect(found).toBeNull()
    expect(env.PATH).toBe(`/usr/bin${delimiter}/bin`)
  })
})
