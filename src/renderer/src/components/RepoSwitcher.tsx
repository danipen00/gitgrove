import type { RecentRepo, RepoInfo, RepoSummary } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { prettyPath } from '../lib/format'
import { highlightMatch } from '../lib/highlight'
import { Icon } from '../lib/icons'
import { isGithubUrl, remoteLabel, revealLabel } from '../lib/repo-actions'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { Popover } from './Popover'

interface Props {
  repo: RepoSummary | null
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
}

/** A right-click target: where to anchor the menu, which repo, and whether it's
 *  a recent-list row (so the menu can offer "Remove from Recents"). */
interface MenuState {
  x: number
  y: number
  repo: RepoInfo
  isRecent: boolean
  /** Resolved remote web URL, or null when the repo has no browsable remote. */
  remote: string | null
}

/** Past this many known repos the popover gains a filter + Recent/All split. */
const RECENT_TOP = 5

export function RepoSwitcher({ repo, onOpenRepo, onPickRepo }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<RecentRepo[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (open) window.gitgrove.recentRepos().then(setRecents)
  }, [open])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  // `recentRepos` returns every known repo, newest first. Once the list is long
  // enough to be awkward to eyeball we offer a filter and a Recent/All split:
  // the handful of newest on top, then the full set alphabetically so any repo
  // is a glance (or a few keystrokes) away.
  const grouped = recents.length > RECENT_TOP
  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return recents
    return recents.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    )
  }, [recents, q])
  const allSorted = useMemo(
    () => [...matches].sort((a, b) => a.name.localeCompare(b.name)),
    [matches]
  )

  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const flash = (message: string, ok = true) => {
    setNotice({ message, ok })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2200)
  }

  const removeRecent = async (path: string) => {
    setRecents(await window.gitgrove.removeRecent(path))
  }

  // Resolve the repo's remote before showing the menu so its items don't reflow
  // mid-open; the cursor point is captured up front since the event is reused.
  const openMenu = async (e: React.MouseEvent, target: RepoInfo, isRecent: boolean) => {
    e.preventDefault()
    const { clientX, clientY } = e
    const remote = await window.gitgrove.remoteUrl(target.path).catch(() => null)
    setMenu({ x: clientX, y: clientY, repo: target, isRecent, remote })
  }

  const buildItems = (m: MenuState): ContextMenuItem[] => {
    const { repo: target, isRecent, remote } = m
    const items: ContextMenuItem[] = [
      {
        label: 'Copy Repo Name',
        icon: <Icon.Copy size={15} />,
        onClick: () => {
          window.gitgrove.clipboardWrite(target.name)
          flash('Copied repository name')
        }
      },
      {
        label: 'Copy Repo Path',
        icon: <Icon.Copy size={15} />,
        onClick: () => {
          window.gitgrove.clipboardWrite(target.path)
          flash('Copied repository path')
        }
      },
      {}
    ]
    if (remote) {
      items.push({
        label: remoteLabel(remote),
        icon: isGithubUrl(remote) ? <Icon.Github size={15} /> : <Icon.External size={15} />,
        onClick: () => window.gitgrove.openExternal(remote)
      })
    }
    items.push(
      {
        label: revealLabel,
        icon: <Icon.Folder size={15} />,
        onClick: async () => {
          if (!(await window.gitgrove.revealRepo(target.path)))
            flash('Could not open the folder', false)
        }
      },
      {
        label: 'Open in Terminal',
        icon: <Icon.Terminal size={15} />,
        onClick: async () => {
          if (!(await window.gitgrove.openTerminal(target.path)))
            flash('No terminal application found', false)
        }
      }
    )
    if (isRecent) {
      items.push(
        {},
        {
          label: 'Remove from Recents',
          icon: <Icon.Trash size={15} />,
          danger: true,
          onClick: () => removeRecent(target.path)
        }
      )
    }
    return items
  }

  const renderRow = (r: RecentRepo) => (
    <button
      key={r.path}
      className={`popover__item${repo?.path === r.path ? ' is-active' : ''}`}
      onClick={() => {
        close()
        onOpenRepo(r.path)
      }}
      onContextMenu={(e) => openMenu(e, r, true)}
    >
      <span className="icon-muted">
        <Icon.Repo size={15} />
      </span>
      <span className="popover__item-main">
        <span className="popover__item-title">{highlightMatch(r.name, query)}</span>
        <span className="popover__item-sub">{highlightMatch(prettyPath(r.path), query)}</span>
      </span>
      <span
        className="popover__item-remove"
        title="Remove from recents"
        onClick={(e) => {
          e.stopPropagation()
          removeRecent(r.path)
        }}
      >
        <Icon.Close size={13} />
      </span>
    </button>
  )

  return (
    <>
      <button
        ref={anchor}
        className="pill"
        onClick={() => (open ? close() : setOpen(true))}
        onContextMenu={repo ? (e) => openMenu(e, repo, false) : undefined}
      >
        <span className="pill__icon">
          <Icon.Repo size={16} />
        </span>
        <span className="pill__label">{repo ? repo.name : 'Open repository'}</span>
        <span className="pill__chev">
          <Icon.Chevron size={14} />
        </span>
      </button>

      <Popover anchor={anchor.current} open={open} onClose={close} width={340}>
        {grouped && (
          <div className="popover__search">
            <input
              autoFocus
              placeholder="Filter repositories…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        <div className="repo-list">
          {recents.length === 0 ? (
            <div className="popover__empty">No recent repositories</div>
          ) : matches.length === 0 ? (
            <div className="popover__empty">No matching repositories</div>
          ) : !grouped || q ? (
            <>
              {!q && <div className="popover__group-label">Recent</div>}
              {matches.map(renderRow)}
            </>
          ) : (
            <>
              <div className="popover__group-label">Recent</div>
              {recents.slice(0, RECENT_TOP).map(renderRow)}
              <div className="popover__group-label">All</div>
              {allSorted.map(renderRow)}
            </>
          )}
        </div>
        <div className="popover__footer">
          <button
            className="btn-ghost"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              close()
              onPickRepo()
            }}
          >
            <Icon.Folder size={15} /> Open another repository…
          </button>
        </div>
      </Popover>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={buildItems(menu)} onClose={() => setMenu(null)} />
      )}

      {notice &&
        createPortal(
          <div className="toast toast--notice" role="status">
            {notice.ok ? <Icon.Check size={15} /> : <Icon.Alert size={15} />}
            <span>{notice.message}</span>
          </div>,
          document.body
        )}
    </>
  )
}
