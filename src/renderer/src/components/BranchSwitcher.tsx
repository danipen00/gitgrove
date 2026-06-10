import type { BranchInfo } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { highlightMatch } from '../lib/highlight'
import { Icon } from '../lib/icons'
import { ContextMenu } from './ContextMenu'
import { Popover } from './Popover'
import { useVirtualScroll, VScrollbar } from './VirtualScroll'

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
/** Empty space kept below the last row so it never sits flush against the edge. */
const PAD_BOTTOM = 8

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'item'; key: string; name: string; current: boolean; local: boolean }

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

  // Main-thread scrolling via the shared scroller (see VirtualScroll.tsx for
  // the full rationale): native compositor scrolling would outrun the windowed
  // rows on fast flings and flash blank.
  const vs = useVirtualScroll({
    count: rows.length,
    rowHeight: ROW_H,
    padBottom: PAD_BOTTOM,
    initialViewportH: ROW_H * 12
  })

  // Reset scroll position when the result set changes or the popover opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query/open are intentional triggers; scrollTo is stable.
  useEffect(() => {
    vs.scrollTo(0)
  }, [query, open])

  const visible = rows.slice(vs.start, vs.end)

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
          <div className="popover__list" ref={vs.viewportRef}>
            <div className="vlist__sizer" style={{ height: vs.totalHeight }} aria-hidden="true" />
            <div className="vlist__content" style={{ transform: `translateY(${-vs.top}px)` }}>
              {visible.map((row, i) => {
                const index = vs.start + i
                const rowStyle = {
                  position: 'absolute' as const,
                  top: vs.rowTop(index),
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
                      <span className="popover__item-title">{highlightMatch(row.name, query)}</span>
                    </span>
                    {row.current && <span className="tag tag--current">current</span>}
                  </button>
                )
              })}
            </div>
            <VScrollbar vs={vs} />
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
