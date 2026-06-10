// The toolbar's fetch/pull/push control. One adaptive button shows the most
// useful action for the branch's state (publish → pull → push → fetch), with
// ahead/behind badges, and a chevron opens the full menu (fetch, pull,
// pull --rebase, push, force push) — all sync in a single compact pill.

import type { SyncStatus } from '@shared/types'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/common/Dialog'
import { Popover } from '@/components/common/Popover'
import { Icon } from '@/lib/icons'

export type SyncAction = 'fetch' | 'pull' | 'pull-rebase' | 'push' | 'force-push' | 'publish'

interface Props {
  sync: SyncStatus | null
  branch: string
  detached: boolean
  busy: boolean
  /** The action currently running, to spin the right glyph. */
  running: SyncAction | null
  /** Determinate 0–100 of the running action, or null before git reports any. */
  progress?: number | null
  onAction: (action: SyncAction) => void
}

export function SyncButton({
  sync,
  branch,
  detached,
  busy,
  running,
  progress = null,
  onAction
}: Props) {
  const [open, setOpen] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  // Nothing to sync with: no remotes configured, or detached HEAD.
  if (!sync || sync.remotes.length === 0 || detached) return null

  const primary: SyncAction = !sync.upstream
    ? 'publish'
    : sync.behind > 0
      ? 'pull'
      : sync.ahead > 0
        ? 'push'
        : 'fetch'

  const RUNNING_LABEL: Record<SyncAction, string> = {
    fetch: 'Fetching…',
    pull: 'Pulling…',
    'pull-rebase': 'Pulling…',
    push: 'Pushing…',
    'force-push': 'Pushing…',
    publish: 'Publishing…'
  }

  const label =
    running !== null
      ? RUNNING_LABEL[running]
      : primary === 'publish'
        ? 'Publish branch'
        : primary === 'pull'
          ? 'Pull'
          : primary === 'push'
            ? 'Push'
            : 'Fetch'

  const glyph =
    running !== null ? (
      <span className="pill__chev is-spinning" style={{ display: 'flex' }}>
        <Icon.Refresh size={15} />
      </span>
    ) : primary === 'push' || primary === 'publish' ? (
      <Icon.Upload size={15} />
    ) : (
      <Icon.Download size={15} />
    )

  const item = (action: SyncAction, icon: React.ReactNode, text: string, tip?: string) => (
    <button
      className="popover__item"
      style={{ position: 'static', height: 32 }}
      data-tip={tip}
      onClick={() => {
        setOpen(false)
        if (action === 'force-push') setConfirmForce(true)
        else onAction(action)
      }}
    >
      <span className="icon-muted" style={{ display: 'flex' }}>
        {icon}
      </span>
      <span className="popover__item-main">
        <span className="popover__item-title">{text}</span>
      </span>
    </button>
  )

  return (
    <>
      <div className="sync">
        <button
          className="pill sync__main"
          disabled={busy}
          data-tip={
            primary === 'publish'
              ? `Publish ${branch} to ${sync.remotes[0]}`
              : `${label} ${sync.upstream ?? ''}`
          }
          onClick={() => onAction(primary)}
        >
          {/* Determinate fill while the running action reports progress. */}
          {running !== null && progress !== null && (
            <span className="pill__fill" style={{ width: `${progress}%` }} aria-hidden="true" />
          )}
          <span className="pill__icon">{glyph}</span>
          <span className="pill__label">{label}</span>
          {sync.behind > 0 && <span className="sync-badge sync-badge--behind">{sync.behind}↓</span>}
          {sync.ahead > 0 && <span className="sync-badge sync-badge--ahead">{sync.ahead}↑</span>}
        </button>
        <button
          ref={anchor}
          className="pill sync__chev"
          disabled={busy}
          aria-label="More sync actions"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon.Chevron size={14} />
        </button>
      </div>

      <Popover
        anchor={anchor.current}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        width={230}
      >
        <div style={{ padding: '6px 0' }}>
          {item('fetch', <Icon.Refresh size={15} />, 'Fetch', 'git fetch --prune')}
          {sync.upstream && item('pull', <Icon.Download size={15} />, 'Pull', 'git pull')}
          {sync.upstream &&
            item(
              'pull-rebase',
              <Icon.Download size={15} />,
              'Pull with rebase',
              'git pull --rebase'
            )}
          {sync.upstream
            ? item('push', <Icon.Upload size={15} />, 'Push', 'git push')
            : item(
                'publish',
                <Icon.Upload size={15} />,
                'Publish branch',
                `push -u ${sync.remotes[0]} ${branch}`
              )}
          {sync.upstream &&
            item(
              'force-push',
              <Icon.Alert size={15} />,
              'Force push…',
              'git push --force-with-lease'
            )}
        </div>
      </Popover>

      {confirmForce && (
        <ConfirmDialog
          title="Force push?"
          danger
          body={
            <>
              This will overwrite <code>{sync.upstream}</code> with your local <code>{branch}</code>{' '}
              using <code>--force-with-lease</code>, which still refuses to clobber commits you
              haven't fetched. Anyone based on the old history will need to recover.
            </>
          }
          confirmLabel="Force push"
          onConfirm={() => {
            setConfirmForce(false)
            onAction('force-push')
          }}
          onCancel={() => setConfirmForce(false)}
        />
      )}
    </>
  )
}
