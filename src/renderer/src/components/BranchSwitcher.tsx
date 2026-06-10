import type { BranchInfo } from '@shared/types'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Icon } from '../lib/icons'
import { ContextMenu } from './ContextMenu'
import { Popover } from './Popover'

/** Branch operations surfaced from the switcher (beyond plain checkout). */
export type BranchAction = 'new' | 'merge' | 'rebase' | 'rename' | 'delete'

interface Props {
  branch: BranchInfo | null
  /** True while the full branch list is being fetched after a repo open. */
  loading?: boolean
  busy: boolean
  onCheckout: (branch: string) => void
  /** When provided, enables the "New branch" footer and per-row context menu. */
  onBranchAction?: (action: BranchAction, branch: string) => void
  /** Called when the popover opens — the branch list is (re)loaded lazily. */
  onOpen?: () => void
}

/** Fixed row height used by the virtualizer (must match the inline row height below). */
const ROW_H = 32
/** A few extra rows above/below the window to cover sub-pixel rounding. */
const OVERSCAN = 4
/** Minimum draggable scrollbar thumb height. */
const MIN_THUMB = 24
/** Empty space kept below the last row so it never sits flush against the edge. */
const PAD_BOTTOM = 8

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'item'; key: string; name: string; current: boolean; local: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

export function BranchSwitcher({
  branch,
  loading = false,
  busy,
  onCheckout,
  onBranchAction,
  onOpen
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchor = useRef<HTMLButtonElement>(null)
  // Right-clicked local branch row: cursor position + branch name.
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null)

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
        out.push({
          kind: 'item',
          key: `l:${name}`,
          name,
          current: name === branch?.current,
          local: true
        })
    }
    if (remotes.length > 0) {
      out.push({ kind: 'label', key: 'label-remote', text: 'Remote' })
      for (const name of remotes)
        out.push({ kind: 'item', key: `r:${name}`, name, current: false, local: false })
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

  const total = rows.length * ROW_H + PAD_BOTTOM
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: query/open are intentional triggers; the body only calls a setter.
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

  const label = branch
    ? branch.detached
      ? `detached @ ${branch.current.slice(0, 7)}`
      : branch.current
    : '—'

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
        onClick={() => {
          setOpen((v) => {
            if (!v) onOpen?.()
            return !v
          })
        }}
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
                    onContextMenu={
                      onBranchAction && row.local
                        ? (e) => {
                            e.preventDefault()
                            setMenu({ x: e.clientX, y: e.clientY, name: row.name })
                          }
                        : undefined
                    }
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
        {onBranchAction && (
          <div className="popover__footer">
            <button
              className="popover__item popover__item--footer"
              onClick={() => {
                setOpen(false)
                setQuery('')
                onBranchAction('new', query.trim())
              }}
            >
              <span className="icon-muted" style={{ display: 'flex' }}>
                <Icon.Plus size={15} />
              </span>
              <span className="popover__item-main">
                <span className="popover__item-title">
                  {query.trim() ? `New branch “${query.trim()}”…` : 'New branch…'}
                </span>
              </span>
            </button>
          </div>
        )}
      </Popover>

      {menu && onBranchAction && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Checkout',
              icon: <Icon.Check size={15} />,
              disabled: menu.name === branch?.current,
              onClick: () => {
                setOpen(false)
                select(menu.name)
              }
            },
            {},
            {
              label: `Merge into ${branch?.current ?? 'current'}…`,
              icon: <Icon.Merge size={15} />,
              disabled: menu.name === branch?.current,
              onClick: () => {
                setOpen(false)
                onBranchAction('merge', menu.name)
              }
            },
            {
              label: `Rebase ${branch?.current ?? 'current'} onto this…`,
              icon: <Icon.Branch size={15} />,
              disabled: menu.name === branch?.current,
              onClick: () => {
                setOpen(false)
                onBranchAction('rebase', menu.name)
              }
            },
            {},
            {
              label: 'Rename…',
              icon: <Icon.Pencil size={15} />,
              onClick: () => {
                setOpen(false)
                onBranchAction('rename', menu.name)
              }
            },
            {
              label: 'Delete…',
              icon: <Icon.Trash size={15} />,
              danger: true,
              disabled: menu.name === branch?.current,
              onClick: () => {
                setOpen(false)
                onBranchAction('delete', menu.name)
              }
            }
          ]}
        />
      )}
    </>
  )
}
