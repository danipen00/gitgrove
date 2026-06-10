// The working-changes list: one row per file with a commit-selection checkbox
// (checked = include in the next commit, indeterminate = some hunks included,
// unchecked = excluded), a status letter, and the path. Checkboxes are pure
// renderer state — toggling never touches git. Conflicted files swap the
// checkbox for an alert glyph and resolve through the context menu.
//
// Windowed rendering: only the visible rows (plus a small overscan) exist in
// the DOM, so the list stays at a few dozen nodes whether the repo has ten
// changed files or ten thousand. Rows are fixed-height and memoized.

import type { ChangedFile } from '@shared/types'
import { memo, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { splitPath, statusLabel, statusLetter } from '../lib/format'
import { Icon } from '../lib/icons'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { FileSelection } from './DiffViewer'

interface Props {
  files: ChangedFile[]
  /** Commit selection per path; missing key = fully included. Omit for read-only lists. */
  selections?: ReadonlyMap<string, FileSelection>
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Toggle a file's inclusion in the next commit. Omit for read-only lists. */
  onToggleIncluded?: (path: string) => void
  contextMenuFor: (file: ChangedFile) => ContextMenuItem[]
}

/** Fixed row height (px) — must match .wfl__row in global.css. */
const ROW_H = 28
// Generous overscan: native scrolling runs on the compositor thread and can
// outrun React's windowed re-render during fast flings; the extra rows keep
// painted content under the viewport until the window catches up.
const OVERSCAN = 30

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
  onSelect: (path: string) => void
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inner checkbox is the keyboard target
    <div
      role="option"
      aria-selected={selected}
      className={`wfl__row${selected ? ' is-selected' : ''}`}
      style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
      onClick={() => onSelect(file.path)}
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
  contextMenuFor
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

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

  const openMenu = (file: ChangedFile, x: number, y: number) => {
    onSelect(file.path)
    setMenu({ x, y, items: contextMenuFor(file) })
  }

  return (
    <div
      ref={viewportRef}
      className="wfl"
      role="listbox"
      aria-label="Changed files"
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
            selected={file.path === selectedPath}
            onSelect={onSelect}
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
