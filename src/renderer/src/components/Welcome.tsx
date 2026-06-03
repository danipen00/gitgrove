import type { RecentRepo } from '@shared/types'
import { useEffect, useState } from 'react'
import { prettyPath } from '../lib/format'
import { Icon } from '../lib/icons'

interface Props {
  onPickRepo: () => void
  onOpenRepo: (path: string) => void
}

export function Welcome({ onPickRepo, onOpenRepo }: Props) {
  const [recents, setRecents] = useState<RecentRepo[]>([])

  useEffect(() => {
    window.gitgrove.recentRepos().then(setRecents)
  }, [])

  return (
    <div className="welcome">
      <div className="welcome__card">
        <div className="welcome__logo">
          <Icon.Tree size={64} />
        </div>
        <h1>GitGrove</h1>
        <p>
          A fast, beautiful window into any git repository — explore your working tree, walk through
          history, and read diffs rendered by Pierre.
        </p>
        <button className="btn-primary" onClick={onPickRepo}>
          <Icon.Folder size={16} /> Open a repository
        </button>

        {recents.length > 0 && (
          <div className="welcome__recents">
            <h4>Recent</h4>
            {recents.slice(0, 6).map((r) => (
              <button key={r.path} className="recent-row" onClick={() => onOpenRepo(r.path)}>
                <span className="icon-muted" style={{ color: 'var(--fg-muted)' }}>
                  <Icon.Repo size={18} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div className="recent-row__name">{r.name}</div>
                  <div className="recent-row__path">{prettyPath(r.path)}</div>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
