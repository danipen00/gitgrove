import type { BranchInfo, RepoSummary } from '@shared/types'
import { Icon } from '../lib/icons'
import { RepoSwitcher } from './RepoSwitcher'
import { BranchSwitcher } from './BranchSwitcher'

interface Props {
  repo: RepoSummary | null
  branch: BranchInfo | null
  busy: boolean
  refreshing: boolean
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
  onCheckout: (branch: string) => void
  onRefresh: () => void
}

export function Toolbar({
  repo,
  branch,
  busy,
  refreshing,
  onOpenRepo,
  onPickRepo,
  onCheckout,
  onRefresh
}: Props) {
  return (
    <header className="toolbar">
      {/* leaves room for the macOS traffic lights in the draggable region */}
      <div className="toolbar__drag-pad" />
      <div className="toolbar__brand">
        <Icon.Tree size={18} />
        GitGrove
      </div>
      <div className="toolbar__sep" />
      <RepoSwitcher repo={repo} onOpenRepo={onOpenRepo} onPickRepo={onPickRepo} />
      {repo && <BranchSwitcher branch={branch} busy={busy} onCheckout={onCheckout} />}
      <div className="toolbar__spacer" />
      {repo && (
        <button
          className={`toolbar__refresh${refreshing ? ' is-spinning' : ''}`}
          title="Refresh"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <Icon.Refresh size={16} />
        </button>
      )}
    </header>
  )
}
