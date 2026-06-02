import { useState } from 'react'

import type { ChangedFile, Commit } from '@shared/types'
import { Icon } from '../lib/icons'
import { pluralize } from '../lib/format'
import { FileTreeView } from './FileTreeView'
import { Resizer } from './Resizer'

interface Props {
  commits: Commit[]
  loading: boolean
  selectedCommit: Commit | null
  onSelectCommit: (commit: Commit) => void
  commitFiles: ChangedFile[]
  commitFilesLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}

function parseRefs(refs: string): { name: string; isTag: boolean }[] {
  if (!refs) return []
  return refs
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('tag:')) return { name: r.slice(4).trim(), isTag: true }
      // "HEAD -> main" → show "main"
      const arrow = r.split('->')
      return { name: arrow[arrow.length - 1].trim(), isTag: false }
    })
}

export function HistoryView({
  commits,
  loading,
  selectedCommit,
  onSelectCommit,
  commitFiles,
  commitFilesLoading,
  selectedFilePath,
  onSelectFile
}: Props) {
  const [detailHeight, setDetailHeight] = useState(300)

  if (loading && commits.length === 0) {
    return (
      <div className="center-state">
        <div className="spinner" />
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="center-state">
        <div className="icon-ring">
          <Icon.History size={22} />
        </div>
        <h3>No history</h3>
        <p>This branch doesn’t have any commits yet.</p>
      </div>
    )
  }

  return (
    <div className="history">
      <div className="commit-list">
        {commits.map((commit) => {
          const refs = parseRefs(commit.refs)
          const active = selectedCommit?.hash === commit.hash
          return (
            <button
              key={commit.hash}
              className={`commit${active ? ' is-active' : ''}`}
              onClick={() => onSelectCommit(commit)}
            >
              <div className="commit__rail">
                <span className="commit__dot" />
              </div>
              <div className="commit__main">
                <div className="commit__subject">{commit.subject}</div>
                {refs.length > 0 && (
                  <div className="commit__refs">
                    {refs.map((ref) => (
                      <span
                        key={ref.name}
                        className={`ref-chip${ref.isTag ? ' ref-chip--tag' : ''}`}
                      >
                        {ref.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="commit__meta">
                  <span className="commit__hash">{commit.shortHash}</span>
                  <span>{commit.authorName}</span>
                  <span>· {commit.relativeDate}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {selectedCommit && (
        <>
          <Resizer orientation="y" onResize={(d) => setDetailHeight((h) => clamp(h - d, 150, 640))} />
          <div className="commit-detail" style={{ height: detailHeight }}>
            <div className="section-head">
              <span className="commit__hash">{selectedCommit.shortHash}</span>
              <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--fg-muted)' }}>
                {commitFilesLoading ? 'Loading…' : pluralize(commitFiles.length, 'file')}
              </span>
              <span className="section-head__spacer" />
            </div>
            <div className="tree-wrap">
              {commitFilesLoading ? (
                <div className="center-state">
                  <div className="spinner" />
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="list-empty">No file changes in this commit.</div>
              ) : (
                <FileTreeView
                  files={commitFiles}
                  selectedPath={selectedFilePath}
                  onSelectFile={onSelectFile}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
