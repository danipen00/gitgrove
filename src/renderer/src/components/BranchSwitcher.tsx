import { useMemo, useRef, useState } from 'react'

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

export function BranchSwitcher({ branch, loading = false, busy, onCheckout }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchor = useRef<HTMLButtonElement>(null)

  const { locals, remotes } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (n: string) => n.toLowerCase().includes(q)
    return {
      locals: (branch?.local ?? []).filter(match),
      remotes: (branch?.remote ?? []).filter(match)
    }
  }, [branch, query])

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
        <div className="popover__list">
          {locals.length > 0 && <div className="popover__group-label">Local</div>}
          {locals.map((name) => (
            <button
              key={name}
              className={`popover__item${name === branch?.current ? ' is-active' : ''}`}
              onClick={() => select(name)}
            >
              <span className="icon-muted">
                <Icon.Branch size={14} />
              </span>
              <span className="popover__item-main">
                <span className="popover__item-title">{name}</span>
              </span>
              {name === branch?.current && <span className="tag tag--current">current</span>}
            </button>
          ))}

          {remotes.length > 0 && <div className="popover__group-label">Remote</div>}
          {remotes.map((name) => (
            <button key={name} className="popover__item" onClick={() => select(name)}>
              <span className="icon-muted">
                <Icon.Branch size={14} />
              </span>
              <span className="popover__item-main">
                <span className="popover__item-title">{name}</span>
              </span>
            </button>
          ))}

          {locals.length === 0 && remotes.length === 0 && (
            <div className="popover__empty">No matching branches</div>
          )}
        </div>
      </Popover>
    </>
  )
}
