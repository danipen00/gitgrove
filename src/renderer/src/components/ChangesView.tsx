import type { ChangedFile } from '@shared/types'
import { Icon } from '../lib/icons'
import { pluralize } from '../lib/format'
import { FileTreeView } from './FileTreeView'

interface Props {
  changes: ChangedFile[]
  loading: boolean
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}

export function ChangesView({ changes, loading, selectedFilePath, onSelectFile }: Props) {
  if (loading && changes.length === 0) {
    return (
      <div className="center-state">
        <div className="spinner" />
      </div>
    )
  }

  if (changes.length === 0) {
    return (
      <div className="center-state">
        <div className="icon-ring">
          <Icon.Check size={22} />
        </div>
        <h3>Working tree clean</h3>
        <p>There are no uncommitted changes. Switch to History to browse past commits.</p>
      </div>
    )
  }

  return (
    <div className="history">
      <div className="section-head">
        <Icon.Changes size={14} />
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--fg-muted)' }}>
          {pluralize(changes.length, 'change')}
        </span>
        <span className="section-head__spacer" />
      </div>
      <div className="tree-wrap">
        <FileTreeView files={changes} selectedPath={selectedFilePath} onSelectFile={onSelectFile} />
      </div>
    </div>
  )
}
