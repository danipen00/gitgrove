import { describe, expect, test } from 'bun:test'
import { appendFile, writeFile } from 'node:fs/promises'
import { openLfsProgressChannel, parseLfsProgressLine } from './lfs-progress'

describe('parseLfsProgressLine', () => {
  test('parses the three directions with byte-based percent', () => {
    expect(parseLfsProgressLine('download 3/12 52428800/104857600 assets/model.bin')).toEqual({
      phase: 'Downloading LFS objects',
      percent: 50
    })
    expect(parseLfsProgressLine('upload 1/1 999/1000 a.bin')).toEqual({
      phase: 'Uploading LFS objects',
      percent: 100 // rounds to 100 — the bar should not sit at 99 forever
    })
    expect(parseLfsProgressLine('checkout 1/4 0/400 b.bin')).toEqual({
      phase: 'Checking out LFS objects',
      percent: 0
    })
  })

  test('file names with spaces do not break the fixed-field prefix', () => {
    expect(parseLfsProgressLine('download 1/2 5/10 my assets/big file.psd')).toEqual({
      phase: 'Downloading LFS objects',
      percent: 50
    })
  })

  test('rejects malformed lines and zero totals', () => {
    expect(parseLfsProgressLine('')).toBeNull()
    expect(parseLfsProgressLine('Receiving objects:  42% (1234/2934)')).toBeNull()
    expect(parseLfsProgressLine('download abc 5/10 x')).toBeNull()
    expect(parseLfsProgressLine('download 0/0 0/0 x')).toBeNull()
    expect(parseLfsProgressLine('migrate 1/2 5/10 x')).toBeNull()
  })

  test('caps percent at 100', () => {
    expect(parseLfsProgressLine('download 1/1 150/100 x')?.percent).toBe(100)
  })
})

describe('openLfsProgressChannel', () => {
  test('tails appended lines and reports the final tick on dispose', async () => {
    const events: Array<{ phase: string; percent: number }> = []
    const channel = openLfsProgressChannel((phase, percent) => {
      events.push({ phase, percent })
    })
    const path = channel.env.GIT_LFS_PROGRESS
    expect(path).toBeTruthy()

    // Simulate git-lfs: the file appears mid-operation and grows by appends.
    await writeFile(path, 'download 1/2 25/100 a.bin\n')
    await appendFile(path, 'download 2/2 100/100 b.bin\n')
    // No timing assumptions: dispose performs the final read itself.
    await channel.dispose()

    expect(events).toEqual([
      { phase: 'Downloading LFS objects', percent: 25 },
      { phase: 'Downloading LFS objects', percent: 100 }
    ])
  })

  test('a command that never writes the file reports nothing', async () => {
    const events: string[] = []
    const channel = openLfsProgressChannel((phase) => {
      events.push(phase)
    })
    await channel.dispose()
    expect(events).toEqual([])
  })

  test('partially written last lines wait for their newline', async () => {
    const events: number[] = []
    const channel = openLfsProgressChannel((_phase, percent) => {
      events.push(percent)
    })
    const path = channel.env.GIT_LFS_PROGRESS
    // A torn write: the line lands without its terminating newline first.
    // Whether a poll catches the torn state (remainder buffering) or the
    // final read sees both halves at once, the events must come out whole —
    // no timing assumptions either way.
    await writeFile(path, 'download 1/2 25/100 a.bin')
    await appendFile(path, '\ndownload 2/2 50/100 b.bin\n')
    await channel.dispose()
    expect(events).toEqual([25, 50])
  })
})
