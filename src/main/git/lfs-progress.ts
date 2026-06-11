// Git LFS transfer progress, surfaced through a side channel.
//
// git's own stderr progress ("Receiving objects: 42%") ends when the git
// object transfer ends — LFS content moves *after* that, through the
// smudge/clean filter or the pre-push hook, and git reports nothing while it
// does. Without this channel a multi-gigabyte LFS pull sits at 100% looking
// frozen. git-lfs offers a file-based protocol instead: when GIT_LFS_PROGRESS
// names a path, lfs appends one line per progress tick:
//
//   <direction> <done files>/<total files> <done bytes>/<total bytes> <name>
//   e.g.  download 3/12 5242880/104857600 assets/model.bin
//
// We hand every spawned git a fresh temp path and tail it by polling (200 ms
// — fs.watch is unreliable for appends across platforms), forwarding
// byte-level percentages to the same ProgressHandler git's stderr feeds. When
// the repo doesn't use LFS (or git-lfs isn't installed) the file simply stays
// empty and the channel costs one stat per tick.

import { randomUUID } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProgressHandler } from './exec'

/** Phase labels shown in the UI, keyed by lfs's direction word. */
const PHASES: Record<string, string> = {
  download: 'Downloading LFS objects',
  upload: 'Uploading LFS objects',
  checkout: 'Checking out LFS objects'
}

const LINE = /^(download|upload|checkout)\s+(\d+)\/(\d+)\s+(\d+)\/(\d+)\s/

/**
 * Parse one progress line into a phase + overall percent (byte-based — bytes
 * track the wait, file counts don't when sizes vary). Pure + exported for
 * tests; returns null for anything that isn't a progress line.
 */
export function parseLfsProgressLine(line: string): { phase: string; percent: number } | null {
  const m = line.match(LINE)
  if (!m) return null
  const totalBytes = Number(m[5])
  if (totalBytes <= 0) return null
  const percent = Math.min(100, Math.round((Number(m[4]) / totalBytes) * 100))
  return { phase: PHASES[m[1]], percent }
}

/** How often the progress file is polled for appended lines (ms). */
const POLL_INTERVAL_MS = 200

export interface LfsProgressChannel {
  /** Merge into the git command's environment. */
  env: Record<string, string>
  /** Stop polling, report any final lines, delete the temp file. */
  dispose: () => Promise<void>
}

/**
 * Open a progress side channel for one git invocation: returns the
 * GIT_LFS_PROGRESS environment to pass and starts tailing the file. Always
 * `dispose()` in a finally — it performs the final read (the last tick often
 * lands after the command exits) and removes the temp file.
 */
export function openLfsProgressChannel(onProgress: ProgressHandler): LfsProgressChannel {
  const path = join(tmpdir(), `gitgrove-lfs-progress-${randomUUID()}`)
  let offset = 0
  let remainder = ''

  const readNewLines = async (): Promise<void> => {
    try {
      const handle = await open(path, 'r')
      try {
        const { size } = await handle.stat()
        if (size <= offset) return
        const { buffer, bytesRead } = await handle.read({
          buffer: Buffer.alloc(size - offset),
          position: offset
        })
        offset += bytesRead
        const text = remainder + buffer.toString('utf8', 0, bytesRead)
        const lines = text.split('\n')
        remainder = lines.pop() ?? '' // keep a partially written last line for the next tick
        for (const line of lines) {
          const event = parseLfsProgressLine(line)
          if (event) onProgress(event.phase, event.percent)
        }
      } finally {
        await handle.close()
      }
    } catch {
      // The file doesn't exist until lfs's first tick — and never does when
      // the repo has no LFS content. Both are the normal quiet case.
    }
  }

  // Reads are chained, never concurrent: a slow tick must not race the next
  // one (or dispose's final read) for the shared offset.
  let chain = Promise.resolve()
  const scheduleRead = (): Promise<void> => {
    chain = chain.then(readNewLines)
    return chain
  }
  const timer = setInterval(scheduleRead, POLL_INTERVAL_MS)

  return {
    env: { GIT_LFS_PROGRESS: path },
    dispose: async () => {
      clearInterval(timer)
      await scheduleRead() // the last tick often lands after git exits
      await rm(path, { force: true }).catch(() => {})
    }
  }
}
