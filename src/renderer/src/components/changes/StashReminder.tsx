// The welcome-back banner: shown at the top of Changes when the current
// branch holds changes GitGrove stashed automatically ("leave them on …" in
// the create-branch dialog). The reminder is the other half of that promise —
// the user said "they'll be waiting when I come back", so when they come back
// the changes greet them, one click from being restored. Renders nothing
// while a merge/rebase/… owns the working tree (restoring mid-op would only
// make a mess).

import type { StashEntry } from '@shared/types'
import { useState } from 'react'
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
            className="btn-primary btn-primary--sm"
            disabled={busy}
            data-tip="Apply the stashed changes and clear the stash"
            onClick={() => runOp(() => gg.stashApply(repoPath, stash.index, true))}
          >
            Restore
          </button>
          <button
            className="btn-ghost btn-ghost--sm"
            disabled={busy}
            data-tip="See what's in the stash first"
            onClick={() => setReviewing(true)}
          >
            Review
          </button>
        </div>
      </div>

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
