import { useEffect, useRef, useState } from 'react'

import type { RecentRepo, RepoSummary } from '@shared/types'
import { Icon } from '../lib/icons'
import { prettyPath } from '../lib/format'
import { Popover } from './Popover'

interface Props {
  repo: RepoSummary | null
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
}

export function RepoSwitcher({ repo, onOpenRepo, onPickRepo }: Props) {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<RecentRepo[]>([])
  const anchor = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) window.gitgrove.recentRepos().then(setRecents)
  }, [open])

  const removeRecent = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setRecents(await window.gitgrove.removeRecent(path))
  }

  return (
    <>
      <button ref={anchor} className="pill" onClick={() => setOpen((v) => !v)}>
        <span className="pill__icon">
          <Icon.Repo size={16} />
        </span>
        <span className="pill__label">{repo ? repo.name : 'Open repository'}</span>
        <span className="pill__chev">
          <Icon.Chevron size={14} />
        </span>
      </button>

      <Popover anchor={anchor.current} open={open} onClose={() => setOpen(false)} width={340}>
        <div className="popover__list">
          {recents.length > 0 && <div className="popover__group-label">Recent</div>}
          {recents.map((r) => (
            <button
              key={r.path}
              className={`popover__item${repo?.path === r.path ? ' is-active' : ''}`}
              onClick={() => {
                setOpen(false)
                onOpenRepo(r.path)
              }}
            >
              <span className="icon-muted">
                <Icon.Repo size={15} />
              </span>
              <span className="popover__item-main">
                <span className="popover__item-title">{r.name}</span>
                <span className="popover__item-sub">{prettyPath(r.path)}</span>
              </span>
              <span
                className="popover__item-remove"
                title="Remove from recents"
                onClick={(e) => removeRecent(e, r.path)}
              >
                <Icon.Close size={13} />
              </span>
            </button>
          ))}
          {recents.length === 0 && <div className="popover__empty">No recent repositories</div>}
        </div>
        <div className="popover__footer">
          <button
            className="btn-ghost"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              setOpen(false)
              onPickRepo()
            }}
          >
            <Icon.Folder size={15} /> Open another repository…
          </button>
        </div>
      </Popover>
    </>
  )
}
