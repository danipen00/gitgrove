// The "what happens to your pending changes" radio cards, shared by every
// branch switch that carries a dirty working tree: the switch-branch dialog
// and the create-branch dialog. One vocabulary for the same decision,
// wherever the user meets it. Leave comes first (the safe, reversible
// default for plain switches); the dialogs preselect what fits their flow.

import type { BranchChangesAction } from '@shared/types'
import type { ReactNode } from 'react'

interface Props {
  /** Branch the changes currently sit on. */
  current: string
  /** Where the user is heading — a <code>branch</code>, or "the new branch". */
  destination: ReactNode
  value: BranchChangesAction
  busy?: boolean
  onChange: (value: BranchChangesAction) => void
}

export function PendingChangesChoice({ current, destination, value, busy, onChange }: Props) {
  return (
    <div className="option-cards" role="radiogroup" aria-label="Your pending changes">
      <label className={`option-card${value === 'leave' ? ' is-active' : ''}`}>
        <input
          type="radio"
          name="pending-changes"
          checked={value === 'leave'}
          disabled={busy}
          onChange={() => onChange('leave')}
        />
        <span className="option-card__text">
          <span className="option-card__title">
            Leave them on <code>{current}</code>
          </span>
          <span className="option-card__sub">
            Saved in a stash — GitGrove reminds you about them when you come back.
          </span>
        </span>
      </label>
      <label className={`option-card${value === 'bring' ? ' is-active' : ''}`}>
        <input
          type="radio"
          name="pending-changes"
          checked={value === 'bring'}
          disabled={busy}
          onChange={() => onChange('bring')}
        />
        <span className="option-card__text">
          <span className="option-card__title">Bring them to {destination}</span>
          <span className="option-card__sub">
            They follow you and apply automatically — you'll be told if anything conflicts.
          </span>
        </span>
      </label>
    </div>
  )
}
