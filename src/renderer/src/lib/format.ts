import type { FileStatus, StashEntry } from '@shared/types'

/** Split a repo-relative path into its directory prefix and basename. */
export function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/')
  if (idx === -1) return { dir: '', name: path }
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}

export function statusLabel(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'Added'
    case 'modified':
      return 'Modified'
    case 'deleted':
      return 'Deleted'
    case 'renamed':
      return 'Renamed'
    case 'untracked':
      return 'Untracked'
    case 'ignored':
      return 'Ignored'
    case 'conflicted':
      return 'Conflicted'
  }
}

/** Single-letter badge used in compact spots. */
export function statusLetter(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
    case 'ignored':
      return 'I'
    case 'conflicted':
      return 'C'
  }
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Display label for a stash: its message; for auto-stashes (changes GitGrove
 * left behind while branching, which carry no user message) a friendly name;
 * the bare ref as a last resort.
 */
export function stashLabel(stash: StashEntry): string {
  if (stash.auto) {
    return stash.branchName ? `Changes left on ${stash.branchName}` : 'Changes left behind'
  }
  return stash.message || `stash@{${stash.index}}`
}

export interface CommitRef {
  name: string
  isTag: boolean
}

/** Parse git's `%D` decoration string into displayable branch/tag refs. */
export function parseRefs(refs: string): CommitRef[] {
  if (!refs) return []
  return refs
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('tag:')) return { name: r.slice(4).trim(), isTag: true }
      // "HEAD -> main" → show "main"
      const arrow = r.split('->')
      return { name: arrow[arrow.length - 1].trim(), isTag: false }
    })
}

/** Human-readable byte size: 0 B, 412 B, 3.4 KB, 1.2 MB, 2.0 GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Shorten an absolute path for display, collapsing the home directory. */
export function prettyPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}
