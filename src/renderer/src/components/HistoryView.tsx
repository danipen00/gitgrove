import { useEffect, useState } from 'react'

import type { ChangedFile, Commit } from '@shared/types'
import { Icon } from '../lib/icons'
import { pluralize } from '../lib/format'
import { Avatar } from './Avatar'
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

/** How many ref chips to show inline in the list before collapsing to "+N". */
const MAX_LIST_REFS = 2

interface Ref {
  name: string
  isTag: boolean
}

function parseRefs(refs: string): Ref[] {
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

function RefChip({ refItem }: { refItem: Ref }) {
  return <span className={`ref-chip${refItem.isTag ? ' ref-chip--tag' : ''}`}>{refItem.name}</span>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      title={copied ? 'Copied!' : label}
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => setCopied(true))
      }}
    >
      {copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}
    </button>
  )
}

function DiffStat({ files }: { files: ChangedFile[] }) {
  let insertions = 0
  let deletions = 0
  for (const f of files) {
    insertions += f.insertions ?? 0
    deletions += f.deletions ?? 0
  }
  if (insertions === 0 && deletions === 0) return null
  return (
    <span className="diff-stat">
      <span className="diff-stat__add">+{insertions}</span>
      <span className="diff-stat__del">−{deletions}</span>
    </span>
  )
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
  const [detailHeight, setDetailHeight] = useState(400)

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

  const detailRefs = selectedCommit ? parseRefs(selectedCommit.refs) : []

  return (
    <div className="history">
      <div className="commit-list">
        {commits.map((commit) => {
          const refs = parseRefs(commit.refs)
          const overflow = refs.length - MAX_LIST_REFS
          const active = selectedCommit?.hash === commit.hash
          return (
            <button
              key={commit.hash}
              className={`commit${active ? ' is-active' : ''}`}
              onClick={() => onSelectCommit(commit)}
            >
              <Avatar name={commit.authorName} email={commit.authorEmail} size={28} />
              <div className="commit__main">
                <div className="commit__subject">{commit.subject}</div>
                {refs.length > 0 && (
                  <div className="commit__refs">
                    {refs.slice(0, MAX_LIST_REFS).map((ref) => (
                      <RefChip key={ref.name} refItem={ref} />
                    ))}
                    {overflow > 0 && <span className="ref-chip ref-chip--more">+{overflow}</span>}
                  </div>
                )}
                <div className="commit__meta">
                  <span className="commit__author">{commit.authorName}</span>
                  <span>· {commit.relativeDate}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {selectedCommit && (
        <>
          <Resizer orientation="y" onResize={(d) => setDetailHeight((h) => clamp(h - d, 180, 640))} />
          <div className="commit-detail" style={{ height: detailHeight }}>
            <div className="commit-detail__head">
              <Avatar name={selectedCommit.authorName} email={selectedCommit.authorEmail} size={34} />
              <div className="commit-detail__head-main">
                <div className="commit-detail__subject">{selectedCommit.subject}</div>
                <div className="commit-detail__byline">
                  <span className="commit-detail__author">{selectedCommit.authorName}</span>
                  <span title={new Date(selectedCommit.date).toLocaleString()}>
                    committed {selectedCommit.relativeDate}
                  </span>
                </div>
              </div>
            </div>

            {selectedCommit.body && (
              <div className="commit-detail__body">{selectedCommit.body}</div>
            )}

            {detailRefs.length > 0 && (
              <div className="commit__refs commit-detail__refs">
                {detailRefs.map((ref) => (
                  <RefChip key={ref.name} refItem={ref} />
                ))}
              </div>
            )}

            <div className="section-head commit-detail__bar">
              <span className="commit__hash">{selectedCommit.shortHash}</span>
              <CopyButton value={selectedCommit.hash} label="Copy commit SHA" />
              <span className="section-head__spacer" />
              <span className="commit-detail__stats">
                {!commitFilesLoading && <DiffStat files={commitFiles} />}
                <span className="commit-detail__count">
                  {commitFilesLoading ? 'Loading…' : pluralize(commitFiles.length, 'file')}
                </span>
              </span>
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
