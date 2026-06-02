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
/** A few extra rows above/below the window to cover sub-pixel rounding. */
const OVERSCAN = 4
/** Minimum draggable scrollbar thumb height. */
const MIN_THUMB = 24

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'item'; key: string; name: string; current: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

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

  // --- Custom (main-thread) scrolling -----------------------------------------
  // Native overflow scrolling runs on the compositor thread and, over a list this
  // tall, scrolls faster than React can swap+paint the windowed rows — leaving
  // unpainted (white/black) frames during fast flings. Driving the scroll on the
  // main thread (overflow:hidden + translateY + custom scrollbar) guarantees a
  // frame is only presented once its rows are painted, so there is never a blank.
  // The list node arrives via a callback ref (not a plain ref): the Popover
  // mounts its children a tick after `open` flips, so effects keyed on `open`
  // would run while the ref is still null. Keying them on the node itself makes
  // them run exactly when it mounts/unmounts.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const [viewportH, setViewportH] = useState(ROW_H * 12)
  const [scrollTop, setScrollTop] = useState(0)

  const total = rows.length * ROW_H
  const maxScroll = Math.max(0, total - viewportH)
  const top = clamp(scrollTop, 0, maxScroll)

  // Measure the viewport, and keep it in sync on resize.
  useLayoutEffect(() => {
    if (!listEl) return
    const measure = () => setViewportH(listEl.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(listEl)
    return () => ro.disconnect()
  }, [listEl])

  // Reset scroll position when the result set changes or the popover opens.
  useEffect(() => {
    setScrollTop(0)
  }, [query, open])

  // Wheel handling must be a non-passive listener so we can preventDefault and
  // own the scroll. flushSync commits the new window synchronously, before paint.
  useEffect(() => {
    if (!listEl) return
    const onWheel = (e: WheelEvent) => {
      if (maxScroll <= 0) return
      e.preventDefault()
      flushSync(() => setScrollTop((s) => clamp(s + e.deltaY, 0, maxScroll)))
    }
    listEl.addEventListener('wheel', onWheel, { passive: false })
    return () => listEl.removeEventListener('wheel', onWheel)
  }, [listEl, maxScroll])

  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((top + viewportH) / ROW_H) + OVERSCAN)
  const visible = rows.slice(start, end)

  const thumbH = total > viewportH ? Math.max(MIN_THUMB, (viewportH * viewportH) / total) : 0
  const thumbTop = maxScroll > 0 ? (top / maxScroll) * (viewportH - thumbH) : 0

  const onThumbDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startTop = top
    const range = viewportH - thumbH
    const onMove = (ev: MouseEvent) => {
      const next = range > 0 ? startTop + ((ev.clientY - startY) / range) * maxScroll : 0
      flushSync(() => setScrollTop(clamp(next, 0, maxScroll)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

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
          <div className="popover__list" ref={setListEl}>
            <div className="vlist__sizer" style={{ height: total }} aria-hidden="true" />
            <div className="vlist__content" style={{ transform: `translateY(${-top}px)` }}>
              {visible.map((row, i) => {
                const index = start + i
                const rowStyle = {
                  position: 'absolute' as const,
                  top: index * ROW_H,
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
                    data-tip={row.name}
                    data-tip-overflow=""
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
            {thumbH > 0 && (
              <div className="vlist__bar">
                <div
                  className="vlist__thumb"
                  style={{ height: thumbH, transform: `translateY(${thumbTop}px)` }}
                  onMouseDown={onThumbDown}
                />
              </div>
            )}
          </div>
        )}
      </Popover>
    </>
  )
}
