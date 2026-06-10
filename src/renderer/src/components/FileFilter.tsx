// Reusable file-list filter: a text input (path substring) plus colored
// status-letter chips. Used by the Changes sidebar and by History's
// commit-files panel so both lists filter the same way.

import type { ChangedFile, FileStatus } from '@shared/types'
import { useCallback, useMemo, useState } from 'react'
import { statusLabel } from '../lib/format'

const DEFAULT_TYPES: readonly FileStatus[] = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'untracked'
]

interface FileFilterResult {
  /** The files passing the current filter (input array when inactive). */
  filtered: ChangedFile[]
  /** The current path query (trimmed-or-not as typed) — for match highlighting. */
  query: string
  /** True when a query or type filter is set. */
  active: boolean
  /** The rendered filter bar. */
  bar: React.ReactNode
  /** Clear query and type chips (e.g. when the underlying list changes). */
  reset: () => void
}

/** Filter state + bar for a ChangedFile list. `types` picks the chips shown. */
export function useFileFilter(
  files: ChangedFile[],
  types: readonly FileStatus[] = DEFAULT_TYPES
): FileFilterResult {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<FileStatus>>(new Set())

  const toggleType = (t: FileStatus) =>
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const reset = useCallback(() => {
    setQuery('')
    setTypeFilter(new Set())
  }, [])

  const active = query.trim() !== '' || typeFilter.size > 0
  const filtered = useMemo(() => {
    if (!active) return files
    const q = query.trim().toLowerCase()
    return files.filter(
      (f) =>
        (q === '' || f.path.toLowerCase().includes(q)) &&
        (typeFilter.size === 0 || typeFilter.has(f.status))
    )
  }, [files, active, query, typeFilter])

  const bar = (
    <div className="wfl-filter">
      <input
        className="wfl-filter__input"
        placeholder="Filter files…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {types.map((t) => (
        <button
          key={t}
          type="button"
          className={`wfl-filter__chip st-${t}${typeFilter.has(t) ? ' is-active' : ''}`}
          data-tip={statusLabel(t)}
          onClick={() => toggleType(t)}
        >
          {t[0].toUpperCase()}
        </button>
      ))}
    </div>
  )

  return { filtered, query, active, bar, reset }
}
