// The welcome-back banner: shown at the top of Changes when the current
// branch holds changes GitGrove stashed automatically ("leave them on …"
// while switching branches). The reminder is the other half of that promise —
// the user said "they'll be waiting when I come back", so when they come back
// the changes greet them as one calm split button: Restore is the everyday
// action, and the caret half holds the rest — review the files first, or
// discard (confirmed) a stash the user no longer cares about. Renders nothing
// while a merge/rebase/… owns the working tree (restoring mid-op would only
// make a mess).

import type { StashEntry } from '@shared/types'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/common/Dialog'
import { Popover } from '@/components/common/Popover'
import { Icon } from '@/lib/icons'
import type { ResolvedTheme } from '@/lib/theme'
import { StashReviewDialog } from './StashReviewDialog'

interface Props {
  repoPath: string
  /** The auto-stash left on the current branch. */
  stash: StashEntry
  busy: boolean
  /** Resolved theme, for the review dialog's diff. */
  theme: ResolvedTheme
  /** Run a mutating op (serialized, auto-refresh, errors → toast). */
  runOp: (fn: () => Promise<unknown>) => Promise<boolean>
}

export function StashReminder({ repoPath, stash, busy, theme, runOp }: Props) {
  const gg = window.gitgrove
  const [reviewing, setReviewing] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuAnchor = useRef<HTMLButtonElement>(null)

  return (
    <>
      <div className="stash-reminder" role="status">
        <span className="stash-reminder__icon" aria-hidden>
          <Icon.Stash size={15} />
        </span>
        <div className="stash-reminder__text">
          <strong>Welcome back — you left changes here</strong>
          <span>
            Stashed {stash.relativeDate}, when you branched off. Restore them to pick up where you
            left off.
          </span>
        </div>
        <div className="stash-reminder__actions">
          <button
            className="btn-primary btn-primary--sm stash-reminder__restore"
            disabled={busy}
            data-tip="Apply the stashed changes and clear the stash"
            onClick={() => runOp(() => gg.stashApply(repoPath, stash.index, true))}
          >
            Restore
          </button>
          <button
            ref={menuAnchor}
            className="stash-reminder__caret"
            disabled={busy}
            aria-haspopup="menu"
            aria-label="More options"
            data-tip="Review or discard"
            onClick={() => setMenuOpen(true)}
          >
            <Icon.Chevron size={12} />
          </button>
        </div>
      </div>

      <Popover
        anchor={menuAnchor.current}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        width={250}
      >
        <div className="popover__list">
          <button
            className="popover__item"
            onClick={() => {
              setMenuOpen(false)
              setReviewing(true)
            }}
          >
            <span className="icon-muted">
              <Icon.Diff size={15} />
            </span>
            <span className="popover__item-main">
              <span className="popover__item-title">Review first</span>
              <span className="popover__item-sub">See what's inside before deciding.</span>
            </span>
          </button>
          <button
            className="popover__item"
            onClick={() => {
              setMenuOpen(false)
              setConfirmDiscard(true)
            }}
          >
            <span className="icon-muted is-danger-text">
              <Icon.Trash size={15} />
            </span>
            <span className="popover__item-main">
              <span className="popover__item-title is-danger-text">Discard…</span>
              <span className="popover__item-sub">Delete these stashed changes for good.</span>
            </span>
          </button>
        </div>
      </Popover>

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard these stashed changes?"
          danger
          busy={busy}
          body={
            <>
              The changes you left here {stash.relativeDate} will be deleted — your current work is
              untouched. This can't be undone.
            </>
          }
          confirmLabel="Discard"
          onConfirm={() => {
            setConfirmDiscard(false)
            runOp(() => gg.stashDrop(repoPath, stash.index))
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {reviewing && (
        <StashReviewDialog
          repoPath={repoPath}
          stash={stash}
          theme={theme}
          onApply={(pop) => {
            setReviewing(false)
            runOp(() => gg.stashApply(repoPath, stash.index, pop))
          }}
          onDrop={() => {
            setReviewing(false)
            runOp(() => gg.stashDrop(repoPath, stash.index))
          }}
          onClose={() => setReviewing(false)}
        />
      )}
    </>
  )
}
