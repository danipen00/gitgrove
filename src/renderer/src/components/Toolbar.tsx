import type { BranchInfo, RepoSummary } from '@shared/types'
import { Icon } from '../lib/icons'
import type { ResolvedTheme, ThemePref } from '../lib/theme'
import { RepoSwitcher } from './RepoSwitcher'
import { BranchSwitcher } from './BranchSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'

interface Props {
  repo: RepoSummary | null
  branch: BranchInfo | null
  branchesLoading: boolean
  busy: boolean
  refreshing: boolean
  themePref: ThemePref
  resolvedTheme: ResolvedTheme
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
  onCheckout: (branch: string) => void
  onRefresh: () => void
  onThemeChange: (pref: ThemePref) => void
}

export function Toolbar({
  repo,
  branch,
  branchesLoading,
  busy,
  refreshing,
  themePref,
  resolvedTheme,
  onOpenRepo,
  onPickRepo,
  onCheckout,
  onRefresh,
  onThemeChange
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
      {repo && (
        <BranchSwitcher
          branch={branch}
          loading={branchesLoading}
          busy={busy}
          onCheckout={onCheckout}
        />
      )}
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
      <ThemeSwitcher pref={themePref} resolved={resolvedTheme} onChange={onThemeChange} />
    </header>
  )
}
