import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
/** How many ref chips the detail panel shows before a "+N" expander. */
const MAX_DETAIL_REFS = 4

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

interface CommitDetailProps {
  commit: Commit
  files: ChangedFile[]
  filesLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}

// Rendered with `key={commit.hash}` so it remounts per commit — that resets the
// collapse state and lets the body-overflow probe run against a fresh, collapsed
// layout without effect-ordering races.
function CommitDetail({ commit, files, filesLoading, selectedFilePath, onSelectFile }: CommitDetailProps) {
  const refs = parseRefs(commit.refs)
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [refsExpanded, setRefsExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Does the clamped body actually overflow? Only then do we offer a toggle.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el) setBodyOverflows(el.scrollHeight - el.clientHeight > 2)
  }, [])

  const visibleRefs = refsExpanded ? refs : refs.slice(0, MAX_DETAIL_REFS)
  const hiddenRefs = refs.length - MAX_DETAIL_REFS

  return (
    <>
      <div className="commit-detail__head">
        <Avatar name={commit.authorName} email={commit.authorEmail} size={34} />
        <div className="commit-detail__head-main">
          <div className="commit-detail__subject">{commit.subject}</div>
          <div className="commit-detail__byline">
            <span className="commit-detail__author">{commit.authorName}</span>
            <span title={new Date(commit.date).toLocaleString()}>
              committed {commit.relativeDate}
            </span>
          </div>
        </div>
      </div>

      {commit.body && (
        <div className="commit-detail__body-wrap">
          <div ref={bodyRef} className={`commit-detail__body${bodyExpanded ? ' is-expanded' : ''}`}>
            {commit.body}
          </div>
          {(bodyOverflows || bodyExpanded) && (
            <button className="link-toggle" onClick={() => setBodyExpanded((v) => !v)}>
              {bodyExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {refs.length > 0 && (
        <div className="commit__refs commit-detail__refs">
          {visibleRefs.map((ref) => (
            <RefChip key={ref.name} refItem={ref} />
          ))}
          {hiddenRefs > 0 && (
            <button
              className="ref-chip ref-chip--more ref-chip--toggle"
              onClick={() => setRefsExpanded((v) => !v)}
            >
              {refsExpanded ? 'Show less' : `+${hiddenRefs}`}
            </button>
          )}
        </div>
      )}

      <div className="section-head commit-detail__bar">
        <span className="commit__hash">{commit.shortHash}</span>
        <CopyButton value={commit.hash} label="Copy commit SHA" />
        <span className="section-head__spacer" />
        <span className="commit-detail__stats">
          {!filesLoading && <DiffStat files={files} />}
          <span className="commit-detail__count">
            {filesLoading ? 'Loading…' : pluralize(files.length, 'file')}
          </span>
        </span>
      </div>

      <div className="tree-wrap">
        {filesLoading ? (
          <div className="center-state">
            <div className="spinner" />
          </div>
        ) : files.length === 0 ? (
          <div className="list-empty">No file changes in this commit.</div>
        ) : (
          <FileTreeView files={files} selectedPath={selectedFilePath} onSelectFile={onSelectFile} />
        )}
      </div>
    </>
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
            <CommitDetail
              key={selectedCommit.hash}
              commit={selectedCommit}
              files={commitFiles}
              filesLoading={commitFilesLoading}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
            />
          </div>
        </>
      )}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
