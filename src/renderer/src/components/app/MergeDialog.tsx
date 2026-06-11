// The merge dialog: shown before any merge so the operation is never a leap
// of faith. It dry-runs the merge in the main process (`git merge-tree`) and
// says up front whether it will complete automatically or stop on conflicts,
// then offers the three ways to bring a branch in — merge, squash, rebase —
// each explained in one plain sentence. Picking one runs it immediately.

import type { MergeKind, MergePreview } from '@shared/types'
import { useEffect, useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { pluralize } from '@/lib/format'
import { Icon } from '@/lib/icons'

interface Props {
  repoPath: string
  /** Branch being merged in. */
  name: string
  /** Branch currently checked out (the merge target). */
  current: string
  busy: boolean
  onConfirm: (kind: MergeKind) => void
  onCancel: () => void
}

/** Conflicted paths listed before collapsing to "+N more". */
const PREVIEW_LIST_MAX = 5

interface Strategy {
  kind: MergeKind
  label: string
  sub: (name: string, current: string) => string
}

const STRATEGIES: Strategy[] = [
  {
    kind: 'merge',
    label: 'Merge',
    sub: (n, c) =>
      `Brings the commits from ${n} into ${c}, tied together by a merge commit. ` +
      'Nothing is rewritten — the safe default.'
  },
  {
    kind: 'squash',
    label: 'Squash',
    sub: (n, c) =>
      `Combines everything from ${n} into one set of staged changes on ${c} — ` +
      'you review them and write a single commit message.'
  },
  {
    kind: 'rebase',
    label: 'Rebase',
    sub: (n, c) =>
      `Replays ${c}'s own commits on top of ${n} for a straight-line history. ` +
      `Rewrites ${c}'s commits — avoid if they're already pushed.`
  }
]

export function MergeDialog({ repoPath, name, current, busy, onConfirm, onCancel }: Props) {
  // null = the dry-run is still computing; 'unknown' covers both old gits and
  // a failed probe — the merge itself works either way.
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [kind, setKind] = useState<MergeKind>('merge')

  useEffect(() => {
    let stale = false
    window.gitgrove
      .mergePreview(repoPath, name)
      .then((p) => {
        if (!stale) setPreview(p)
      })
      .catch(() => {
        if (!stale) setPreview({ outcome: 'unknown', conflictedPaths: [], commitCount: 0 })
      })
    return () => {
      stale = true
    }
  }, [repoPath, name])

  const upToDate = preview?.outcome === 'up-to-date'
  const overflow = (preview?.conflictedPaths.length ?? 0) - PREVIEW_LIST_MAX
  const actionLabel = kind === 'merge' ? 'Merge' : kind === 'squash' ? 'Squash & stage' : 'Rebase'

  return (
    <DialogShell
      title={`Merge ${name} into ${current}`}
      icon={<Icon.Merge size={22} />}
      busy={busy}
      onClose={onCancel}
      width={460}
    >
      {preview === null ? (
        <div className="merge-preview merge-preview--loading" role="status">
          <span className="about__spinner" aria-hidden />
          Checking how this merge will go…
        </div>
      ) : upToDate ? (
        <div className="merge-preview merge-preview--clean" role="status">
          <Icon.Check size={15} />
          <span>
            <code>{current}</code> already has everything from <code>{name}</code> — there is
            nothing to merge.
          </span>
        </div>
      ) : preview.outcome === 'clean' ? (
        <div className="merge-preview merge-preview--clean" role="status">
          <Icon.Check size={15} />
          <span>
            No conflicts — {pluralize(preview.commitCount, 'commit')} from <code>{name}</code> will
            merge automatically.
          </span>
        </div>
      ) : preview.outcome === 'conflicts' ? (
        <div className="merge-preview merge-preview--conflicts" role="status">
          <div className="merge-preview__line">
            <Icon.Alert size={15} />
            <span>
              {pluralize(preview.conflictedPaths.length, 'file')} will need a quick conflict
              resolution — GitGrove walks you through it.
            </span>
          </div>
          <div className="merge-preview__files">
            {preview.conflictedPaths.slice(0, PREVIEW_LIST_MAX).map((p) => (
              <code key={p}>{p}</code>
            ))}
            {overflow > 0 && <span>…and {pluralize(overflow, 'more file')}</span>}
          </div>
        </div>
      ) : (
        <div className="merge-preview merge-preview--unknown" role="status">
          <Icon.Diff size={15} />
          <span>
            {preview.commitCount > 0
              ? `${pluralize(preview.commitCount, 'commit')} to bring in. `
              : ''}
            Conflict prediction needs git 2.38+ — merging is still safe, and aborting is one click.
          </span>
        </div>
      )}

      {!upToDate && (
        <div className="option-cards" role="radiogroup" aria-label="How to merge">
          {STRATEGIES.map((s) => (
            <label key={s.kind} className={`option-card${kind === s.kind ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="merge-kind"
                checked={kind === s.kind}
                disabled={busy}
                onChange={() => setKind(s.kind)}
              />
              <span className="option-card__text">
                <span className="option-card__title">{s.label}</span>
                <span className="option-card__sub">{s.sub(name, current)}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="trust__actions">
        <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={busy}>
          {upToDate ? 'Close' : 'Cancel'}
        </button>
        {!upToDate && (
          <button
            className="btn-primary btn-primary--sm"
            onClick={() => onConfirm(kind)}
            disabled={busy}
          >
            {busy && <span className="about__spinner" aria-hidden />}
            {actionLabel}
          </button>
        )}
      </div>
    </DialogShell>
  )
}
