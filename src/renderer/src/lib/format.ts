import type { FileStatus } from '@shared/types'

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

/** Shorten an absolute path for display, collapsing the home directory. */
export function prettyPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}
