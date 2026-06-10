// Keyboard navigation for popover lists (repo / branch / stash switchers):
// arrows + PageUp/PageDown + Home/End move a highlighted index, Enter
// activates it. The listener is window-level while the popover is open, so
// navigation works whether focus sits in the filter input or nowhere at all —
// the user can open the popover and just type and arrow without clicking.

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Next highlighted index for a navigation key (clamped to [0, count)), or
 * null when the key isn't a navigation key. Pure + exported for tests.
 */
export function navTarget(
  key: string,
  current: number,
  count: number,
  page: number
): number | null {
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, current + 1)
    case 'ArrowUp':
      return Math.max(0, current - 1)
    case 'PageDown':
      return Math.min(count - 1, current + page)
    case 'PageUp':
      return Math.max(0, current - page)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

interface Options {
  /** Listen only while the popover is open. */
  enabled: boolean
  /** Number of selectable items (labels and headers excluded). */
  count: number
  /** Items per PageUp/PageDown jump — roughly one viewport of rows. */
  page?: number
  /** Enter on the highlighted item. */
  onActivate: (index: number) => void
  /** Enter while the list is empty — e.g. a "create what you typed" footer. */
  onActivateEmpty?: () => void
  /** Highlight moved — keep the item scrolled into view. */
  onHighlight?: (index: number) => void
}

export interface ListKeyNav {
  /** The highlighted index, clamped to the current count. */
  index: number
  /** Move the highlight programmatically (e.g. reset to 0 when the filter changes). */
  setIndex: (index: number) => void
}

export function useListKeyNav({
  enabled,
  count,
  page = 10,
  onActivate,
  onActivateEmpty,
  onHighlight
}: Options): ListKeyNav {
  const [index, setIndex] = useState(0)

  // The listener subscribes once per open; everything it reads lives in a ref
  // so highlight moves don't re-subscribe it.
  const live = useRef({ index, count, page, onActivate, onActivateEmpty, onHighlight })
  live.current = { index, count, page, onActivate, onActivateEmpty, onHighlight }

  // Each open starts fresh at the top.
  useEffect(() => {
    if (enabled) setIndex(0)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const { index, count, page, onActivate, onActivateEmpty, onHighlight } = live.current
      if (e.key === 'Enter') {
        e.preventDefault()
        if (count === 0) onActivateEmpty?.()
        else onActivate(Math.min(index, count - 1))
        return
      }
      if (count === 0) return
      const current = Math.min(index, count - 1)
      const target = navTarget(e.key, current, count, page)
      if (target === null) return
      // preventDefault keeps arrows from moving the filter input's caret and
      // PageUp/Down from scrolling anything behind the popover.
      e.preventDefault()
      setIndex(target)
      onHighlight?.(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const setIndexStable = useCallback((i: number) => setIndex(i), [])

  return { index: Math.max(0, Math.min(index, count - 1)), setIndex: setIndexStable }
}
