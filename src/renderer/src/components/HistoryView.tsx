import type { ChangedFile, Commit } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { parseRefs, pluralize } from '../lib/format'
import { Icon } from '../lib/icons'
import { Avatar } from './Avatar'
import { RefChip } from './CommitSummary'
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
  const [filesHeight, setFilesHeight] = useState(360)
  // Height is applied to this node directly while dragging (see Resizer.onPreview)
  // so resizing the commit-files panel never re-renders the history list.
  const filesRef = useRef<HTMLDivElement>(null)
  // Selecting a commit reveals the files panel below the list, which shrinks the
  // scroll viewport — a bottom row can end up below the fold. Pull the active row
  // back into view (block:'nearest' leaves already-visible rows untouched).
  const activeRef = useRef<HTMLButtonElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are intentional triggers; the body only reads a ref.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedCommit?.hash, filesHeight])

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
          const overflow = refs.length - MAX_LIST_REFS
          const active = selectedCommit?.hash === commit.hash
          return (
            <button
              key={commit.hash}
              ref={active ? activeRef : null}
              className={`commit${active ? ' is-active' : ''}`}
              onClick={() => onSelectCommit(commit)}
            >
              <Avatar name={commit.authorName} email={commit.authorEmail} size={28} />
              <div className="commit__main">
                <div className="commit__subject" data-tip={commit.subject} data-tip-overflow="">
                  {commit.subject}
                </div>
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
          <Resizer
            orientation="y"
            invert
            size={filesHeight}
            min={140}
            max={640}
            onPreview={(h) => {
              if (filesRef.current) filesRef.current.style.height = `${h}px`
            }}
            onCommit={setFilesHeight}
          />
          <div className="commit-files" ref={filesRef} style={{ height: filesHeight }}>
            <div className="section-head commit-files__head">
              {commitFilesLoading ? 'Loading…' : pluralize(commitFiles.length, 'file')}
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
