import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import type { BranchInfo } from '@shared/types'
import { Icon } from '../lib/icons'
import { Popover } from './Popover'

interface Props {
  branch: BranchInfo | null
  /** True while the full branch list is being fetched after a repo open. */
  loading?: boolean
  busy: boolean
  onCheckout: (branch: string) => void
}

/** Fixed row height used by the virtualizer (must match the inline row height below). */
const ROW_H = 32

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'item'; key: string; name: string; current: boolean }

export function BranchSwitcher({ branch, loading = false, busy, onCheckout }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchor = useRef<HTMLButtonElement>(null)

  // Flat row model (group labels interleaved with branch items) so a single
  // virtualized scroller can window both groups together.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (n: string) => n.toLowerCase().includes(q)
    const out: Row[] = []
    const locals = (branch?.local ?? []).filter(match)
    const remotes = (branch?.remote ?? []).filter(match)
    if (locals.length > 0) {
      out.push({ kind: 'label', key: 'label-local', text: 'Local' })
      for (const name of locals)
        out.push({ kind: 'item', key: `l:${name}`, name, current: name === branch?.current })
    }
    if (remotes.length > 0) {
      out.push({ kind: 'label', key: 'label-remote', text: 'Remote' })
      for (const name of remotes) out.push({ kind: 'item', key: `r:${name}`, name, current: false })
    }
    return out
  }, [branch, query])

  // --- Virtualization state ---------------------------------------------------
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(ROW_H * 12)

  // Measure the scroll viewport before paint, and keep it in sync on resize.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!open || !el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // Reset the scroll position whenever the result set changes or the popover opens.
  useEffect(() => {
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query, open])

  const total = rows.length * ROW_H
  // Overscan a couple of viewports in each direction. The compositor scrolls the
  // container ahead of the main-thread scroll event, so this buffer is what keeps
  // painted rows under the viewport during fast/momentum flings (no white gaps).
  const overscan = Math.max(16, Math.ceil((viewportH / ROW_H) * 2))
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + overscan)
  const visible = rows.slice(start, end)

  const label = branch ? (branch.detached ? `detached @ ${branch.current.slice(0, 7)}` : branch.current) : '—'

  const select = (name: string) => {
    setOpen(false)
    setQuery('')
    if (name !== branch?.current) onCheckout(name)
  }

  return (
    <>
      <button
        ref={anchor}
        className="pill"
        disabled={!branch || busy || loading}
        title={loading ? 'Loading branches…' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pill__icon">
          <Icon.Branch size={16} />
        </span>
        <span className="pill__label">{label}</span>
        <span className={`pill__chev${loading ? ' is-spinning' : ''}`}>
          {loading ? <Icon.Refresh size={14} /> : <Icon.Chevron size={14} />}
        </span>
      </button>

      <Popover anchor={anchor.current} open={open} onClose={() => setOpen(false)} width={300}>
        <div className="popover__search">
          <input
            autoFocus
            placeholder="Switch branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {rows.length === 0 ? (
          <div className="popover__empty">No matching branches</div>
        ) : (
          <div
            className="popover__list"
            ref={listRef}
            onScroll={(e) => {
              // Commit the new window synchronously so the rows are in the DOM
              // before the browser paints the scrolled position.
              const next = e.currentTarget.scrollTop
              flushSync(() => setScrollTop(next))
            }}
          >
            <div style={{ height: total, position: 'relative' }}>
              {visible.map((row, i) => {
                const top = (start + i) * ROW_H
                const rowStyle = {
                  position: 'absolute' as const,
                  top,
                  left: 0,
                  right: 0,
                  height: ROW_H,
                  boxSizing: 'border-box' as const
                }
                if (row.kind === 'label') {
                  return (
                    <div key={row.key} className="popover__group-label" style={rowStyle}>
                      {row.text}
                    </div>
                  )
                }
                return (
                  <button
                    key={row.key}
                    className={`popover__item${row.current ? ' is-active' : ''}`}
                    style={rowStyle}
                    onClick={() => select(row.name)}
                  >
                    <span className="icon-muted branch-glyph" aria-hidden="true" />
                    <span className="popover__item-main">
                      <span className="popover__item-title">{row.name}</span>
                    </span>
                    {row.current && <span className="tag tag--current">current</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Popover>
    </>
  )
}
