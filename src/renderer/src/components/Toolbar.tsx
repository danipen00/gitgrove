import type { BranchInfo, RepoSummary } from '@shared/types'
import { Icon } from '../lib/icons'
import { isMac } from '../lib/platform'
import type { ResolvedTheme, ThemePref } from '../lib/theme'
import { BranchSwitcher } from './BranchSwitcher'
import { RepoSwitcher } from './RepoSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WindowControls } from './WindowControls'

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
  onAbout: () => void
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
  onThemeChange,
  onAbout
}: Props) {
  return (
    <header className="toolbar">
      {/* leaves room for the macOS traffic lights in the draggable region */}
      {isMac && <div className="toolbar__drag-pad" />}
      <button className="toolbar__brand" title="About GitGrove" onClick={onAbout}>
        <Icon.Tree size={18} />
        GitGrove
      </button>
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
      {/* Windows/Linux: the toolbar is the title bar, so it carries the caption
          buttons. macOS uses its native traffic lights instead. */}
      {!isMac && <WindowControls />}
    </header>
  )
}
