// The working-changes list: one row per file with a commit-selection checkbox
// (checked = include in the next commit, indeterminate = some hunks included,
// unchecked = excluded), a status letter, and the path. Checkboxes are pure
// renderer state — toggling never touches git. Conflicted files swap the
// checkbox for an alert glyph and resolve through the context menu.
//
// Selection is a standard multi-select listbox: click selects one row,
// Shift+click extends a range from the anchor, Cmd/Ctrl+click toggles a row,
// arrows / PageUp / PageDown / Home / End move focus (Shift extends),
// Cmd/Ctrl+A selects all. The parent only tracks the *focused* row (it drives
// the diff pane); the full set lives here and is handed to the context menu
// and bulk include/exclude callbacks.
//
// Windowed rendering: only the visible rows (plus a small overscan) exist in
// the DOM, so the list stays at a few dozen nodes whether the repo has ten
// changed files or ten thousand. Rows are fixed-height and memoized.

import type { ChangedFile } from '@shared/types'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { splitPath, statusLabel, statusLetter } from '../lib/format'
import { Icon } from '../lib/icons'
import { isCmdOrCtrl } from '../lib/platform'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { FileSelection } from './DiffViewer'

interface Props {
  files: ChangedFile[]
  /** Commit selection per path; missing key = fully included. Omit for read-only lists. */
  selections?: ReadonlyMap<string, FileSelection>
  /** Focused row (repo-relative path) — the one whose diff is shown. */
  selectedPath: string | null
  /** Focus change. null = the selection was emptied (Cmd/Ctrl+click on the last row). */
  onSelect: (path: string | null) => void
  /** Toggle a file's inclusion in the next commit. Omit for read-only lists. */
  onToggleIncluded?: (path: string) => void
  /** Bulk include/exclude — Space over a multi-selection. Omit for read-only lists. */
  onSetIncluded?: (paths: string[], included: boolean) => void
  /** Right-click menu for the current selection, passed in list order. */
  contextMenuFor: (files: ChangedFile[]) => ContextMenuItem[]
}

/** Fixed row height (px) — must match .wfl__row in global.css. */
const ROW_H = 28
// Generous overscan: native scrolling runs on the compositor thread and can
// outrun React's windowed re-render during fast flings; the extra rows keep
// painted content under the viewport until the window catches up.
const OVERSCAN = 30

const EMPTY_SET: ReadonlySet<string> = new Set()

type CheckState = 'checked' | 'indeterminate' | 'unchecked'

function checkState(sel: FileSelection | undefined): CheckState {
  if (sel === undefined || sel === 'all') return 'checked'
  if (sel === 'none') return 'unchecked'
  return 'indeterminate'
}

interface RowProps {
  file: ChangedFile
  /** null renders a read-only row (History's commit files). */
  check: CheckState | null
  top: number
  selected: boolean
  onSelect: (path: string, e: React.MouseEvent) => void
  onToggleIncluded?: (path: string) => void
  onMenu: (file: ChangedFile, x: number, y: number) => void
}

const Row = memo(function Row({
  file,
  check,
  top,
  selected,
  onSelect,
  onToggleIncluded,
  onMenu
}: RowProps) {
  const conflicted = file.status === 'conflicted'
  const { dir, name } = splitPath(file.path)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox viewport is the keyboard target
    <div
      role="option"
      aria-selected={selected}
      className={`wfl__row${selected ? ' is-selected' : ''}`}
      style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
      onClick={(e) => onSelect(file.path, e)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(file, e.clientX, e.clientY)
      }}
    >
      {check !== null &&
        (conflicted ? (
          <span className="wfl__conflict" data-tip="Conflicted — resolve via right-click">
            <Icon.Alert size={14} />
          </span>
        ) : (
          <input
            type="checkbox"
            className="wfl__check"
            checked={check === 'checked'}
            ref={(el) => {
              if (el) el.indeterminate = check === 'indeterminate'
            }}
            data-tip={check === 'unchecked' ? 'Include in commit' : 'Exclude from commit'}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleIncluded?.(file.path)}
          />
        ))}
      <span className={`wfl__status st-${file.status}`} data-tip={statusLabel(file.status)}>
        {statusLetter(file.status)}
      </span>
      <span className="wfl__path" data-tip={file.path} data-tip-overflow="">
        {dir && <span className="wfl__dir">{dir}</span>}
        <span className="wfl__name">{name}</span>
      </span>
    </div>
  )
})

export function WorkingFileList({
  files,
  selections,
  selectedPath,
  onSelect,
  onToggleIncluded,
  onSetIncluded,
  contextMenuFor
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

  // Multi-selection. `multi` is only honoured while it contains the focused
  // path — when the parent moves focus externally (refresh pruning a deleted
  // file, auto-select after a repo switch) the selection collapses to the
  // focused row, which keeps the two sources of truth from drifting. The
  // anchor (last non-shift interaction) is a ref: it never affects rendering.
  const [multi, setMulti] = useState<ReadonlySet<string>>(EMPTY_SET)
  const anchorRef = useRef<string | null>(null)

  const indexOf = useMemo(() => {
    const m = new Map<string, number>()
    files.forEach((f, i) => m.set(f.path, i))
    return m
  }, [files])

  const selected: ReadonlySet<string> = useMemo(() => {
    if (selectedPath !== null && multi.has(selectedPath)) return multi
    return selectedPath !== null ? new Set([selectedPath]) : EMPTY_SET
  }, [multi, selectedPath])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(files.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)

  /** Inclusive range of paths between two indexes, in list order. */
  const rangeSet = (a: number, b: number): Set<string> => {
    const next = new Set<string>()
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(files[i].path)
    return next
  }

  /** Closest still-selected path to a removed index — the next one wins ties. */
  const nearestSelected = (set: ReadonlySet<string>, idx: number): string | null => {
    if (set.size === 0) return null
    for (let d = 1; d <= files.length; d++) {
      const after = files[idx + d]
      if (after && set.has(after.path)) return after.path
      const before = files[idx - d]
      if (before && set.has(before.path)) return before.path
    }
    return null
  }

  /** Index of the Shift-range anchor, falling back to focus, then `idx`. */
  const anchorIndex = (idx: number): number =>
    (anchorRef.current !== null ? indexOf.get(anchorRef.current) : undefined) ??
    (selectedPath !== null ? indexOf.get(selectedPath) : undefined) ??
    idx

  // Keyboard scrolling must keep the focused row on screen; the windowed
  // viewport only knows pixel offsets, so nudge scrollTop just enough.
  const ensureVisible = (idx: number) => {
    const el = viewportRef.current
    if (!el) return
    const top = idx * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight
  }

  // Clicks pull focus to the listbox so keyboard navigation lands here
  // instead of scrolling the viewport.
  const handleRowClick = (path: string, e: React.MouseEvent) => {
    viewportRef.current?.focus()
    const idx = indexOf.get(path)
    if (idx === undefined) return
    if (e.shiftKey) {
      // Extend from the anchor; the anchor itself stays put.
      setMulti(rangeSet(anchorIndex(idx), idx))
      onSelect(path)
    } else if (isCmdOrCtrl(e)) {
      const next = new Set(selected)
      anchorRef.current = path
      if (next.has(path)) {
        next.delete(path)
        setMulti(next)
        // Removing the focused row hands focus to its nearest neighbour so
        // the diff pane never shows a deselected file.
        if (path === selectedPath) onSelect(nearestSelected(next, idx))
      } else {
        next.add(path)
        setMulti(next)
        onSelect(path)
      }
    } else {
      anchorRef.current = path
      setMulti(new Set([path]))
      onSelect(path)
    }
  }

  /** Move focus to `to` (clamped); Shift extends the range from the anchor. */
  const moveFocus = (to: number, extend: boolean) => {
    const idx = Math.max(0, Math.min(files.length - 1, to))
    const path = files[idx].path
    if (extend) {
      setMulti(rangeSet(anchorIndex(idx), idx))
    } else {
      anchorRef.current = path
      setMulti(new Set([path]))
    }
    if (path !== selectedPath) onSelect(path)
    ensureVisible(idx)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (files.length === 0) return

    // Space/Enter toggle inclusion for the whole selection; preventDefault
    // keeps Space from falling through to the browser and scrolling.
    if (e.key === ' ' || e.key === 'Enter') {
      if (!onSetIncluded || !selections) return
      const sel = files.filter((f) => selected.has(f.path) && f.status !== 'conflicted')
      if (sel.length === 0) return
      e.preventDefault()
      // Mirrors the single-file checkbox: indeterminate (partial hunks) or
      // unchecked anywhere → include everything; all checked → exclude.
      const fullyIncluded = sel.every((f) => (selections.get(f.path) ?? 'all') === 'all')
      onSetIncluded(
        sel.map((f) => f.path),
        !fullyIncluded
      )
      return
    }

    if (isCmdOrCtrl(e) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setMulti(new Set(files.map((f) => f.path)))
      anchorRef.current = files[0].path
      // Focus must live inside the selection (see `selected` above).
      if (selectedPath === null || !indexOf.has(selectedPath)) onSelect(files[0].path)
      return
    }

    const cur = selectedPath !== null ? (indexOf.get(selectedPath) ?? -1) : -1
    const page = Math.max(1, Math.floor(viewportH / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(cur < 0 ? 0 : cur + 1, e.shiftKey)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(cur < 0 ? files.length - 1 : cur - 1, e.shiftKey)
        break
      case 'PageDown':
        e.preventDefault()
        moveFocus(cur < 0 ? page : cur + page, e.shiftKey)
        break
      case 'PageUp':
        e.preventDefault()
        moveFocus(cur < 0 ? 0 : cur - page, e.shiftKey)
        break
      case 'Home':
        e.preventDefault()
        moveFocus(0, e.shiftKey)
        break
      case 'End':
        e.preventDefault()
        moveFocus(files.length - 1, e.shiftKey)
        break
    }
  }

  const openMenu = (file: ChangedFile, x: number, y: number) => {
    viewportRef.current?.focus()
    // Right-click outside the selection re-selects that row first (the
    // platform convention); inside it, the menu targets the whole selection.
    let sel = selected
    if (!selected.has(file.path)) {
      anchorRef.current = file.path
      sel = new Set([file.path])
      setMulti(sel)
      onSelect(file.path)
    }
    setMenu({ x, y, items: contextMenuFor(files.filter((f) => sel.has(f.path))) })
  }

  return (
    <div
      ref={viewportRef}
      className="wfl"
      role="listbox"
      aria-label="Changed files"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={(e) => {
        // flushSync commits the new window synchronously within the scroll
        // event, so freshly exposed rows paint in the same frame instead of
        // flashing blank during fast scrolls.
        const top = e.currentTarget.scrollTop
        flushSync(() => setScrollTop(top))
      }}
    >
      <div style={{ position: 'relative', height: files.length * ROW_H }}>
        {files.slice(start, end).map((file, i) => (
          <Row
            key={file.path}
            file={file}
            check={selections ? checkState(selections.get(file.path)) : null}
            top={(start + i) * ROW_H}
            selected={selected.has(file.path)}
            onSelect={handleRowClick}
            onToggleIncluded={onToggleIncluded}
            onMenu={openMenu}
          />
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
