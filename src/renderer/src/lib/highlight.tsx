// Wrap the matched portion of a filtered list item so it stands out. The
// renderer's list filters all match a case-insensitive substring, so this
// mirrors that: every occurrence of `query` inside `text` is wrapped in a
// <mark>. Returns the plain string untouched when there's no query or no
// match, so unfiltered rows pay nothing.

import type { ReactNode } from 'react'

export function highlightMatch(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase()
  if (!needle) return text

  const hay = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="hl">
        {text.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
  }
  if (parts.length === 0) return text
  if (from < text.length) parts.push(text.slice(from))
  return parts
}
