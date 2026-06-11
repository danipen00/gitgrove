// Shown before switching to an existing branch while the working tree is
// dirty: the changes either stay behind on the current branch (auto-stashed,
// preselected — a plain switch is usually a context switch) or follow the
// user to the destination. The same choreography as the create-branch dialog
// (see PendingChangesChoice and main/git/write.ts checkoutWithChanges); a
// clean tree never sees this dialog.

import type { BranchChangesAction } from '@shared/types'
import { useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { pluralize } from '@/lib/format'
import { Icon } from '@/lib/icons'
import { PendingChangesChoice } from './PendingChangesChoice'

interface Props {
  /** Branch being switched to. */
  target: string
  /** Branch currently checked out. */
  current: string
  /** Uncommitted changes in the working tree. */
  dirtyCount: number
  busy: boolean
  onConfirm: (changes: BranchChangesAction) => void
  onCancel: () => void
}

export function SwitchBranchDialog({
  target,
  current,
  dirtyCount,
  busy,
  onConfirm,
  onCancel
}: Props) {
  const [changes, setChanges] = useState<BranchChangesAction>('leave')

  return (
    <DialogShell
      title={`Switch to ${target}`}
      icon={<Icon.Branch size={22} />}
      busy={busy}
      onClose={onCancel}
      width={460}
    >
      <p className="trust__body">
        You have {pluralize(dirtyCount, 'pending change')} on <code>{current}</code>. What should
        happen to them?
      </p>
      <PendingChangesChoice
        current={current}
        destination={<code>{target}</code>}
        value={changes}
        busy={busy}
        onChange={setChanges}
      />
      <div className="trust__actions">
        <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn-primary btn-primary--sm"
          onClick={() => onConfirm(changes)}
          disabled={busy}
        >
          Switch
        </button>
      </div>
    </DialogShell>
  )
}
