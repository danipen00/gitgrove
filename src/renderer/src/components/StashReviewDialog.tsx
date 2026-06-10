// Review a stash like a commit: a stash *is* a commit whose diff against its
// first parent is exactly the stashed change, so this dialog reuses the
// commit-diff machinery with the stash's sha. Untracked files are the one
// twist — `git stash push -u` stores them in a separate parentless commit
// (the stash's third parent), so they're listed via the stashFiles IPC and
// diffed against that commit instead. Files on the left (same list UI as
// Changes/History), the full diff on the right, with Apply / Pop / Drop.

import type { ChangedFile, DiffPayload, StashEntry } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pluralize } from '../lib/format'
import { Icon } from '../lib/icons'
import { type DiffMode, DiffViewer } from './DiffViewer'
import type { ResolvedTheme } from '../lib/theme'
import { WorkingFileList } from './WorkingFileList'

interface Props {
  repoPath: string
  stash: StashEntry
  theme: ResolvedTheme
  /** Apply the stash (pop = drop it afterwards). */
  onApply: (pop: boolean) => void
  onDrop: () => void
  onClose: () => void
}

export function StashReviewDialog({ repoPath, stash, theme, onApply, onDrop, onClose }: Props) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [mode, setMode] = useState<DiffMode>('split')
  const [wrap, setWrap] = useState(false)
  const diffReq = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadDiff = (file: ChangedFile) => {
    const id = ++diffReq.current
    setSelected(file.path)
    setDiffLoading(true)
    // Untracked entries live in the stash's third parent (a root commit), so
    // diffing that commit shows them as their full added contents.
    const hash = file.status === 'untracked' ? `${stash.sha}^3` : stash.sha
    window.gitgrove
      .commitDiff(repoPath, hash, file)
      .then((payload) => {
        if (id === diffReq.current) setDiff(payload)
      })
      .catch(() => {})
      .finally(() => {
        if (id === diffReq.current) setDiffLoading(false)
      })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per stash
  useEffect(() => {
    window.gitgrove
      .stashFiles(repoPath, stash.sha)
      .then((list) => {
        setFiles(list)
        if (list.length > 0) loadDiff(list[0])
      })
      .catch(() => setFiles([]))
  }, [repoPath, stash.sha])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal stash-review"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="stash-review__head">
          <span className="trust__icon">
            <Icon.Stash size={20} />
          </span>
          <div className="stash-review__title">
            <h2>{stash.message || `stash@{${stash.index}}`}</h2>
            <span>
              {stash.relativeDate}
              {files ? ` · ${pluralize(files.length, 'file')}` : ''}
            </span>
          </div>
          <button className="btn-ghost btn-ghost--sm" onClick={() => onApply(false)}>
            Apply
          </button>
          <button className="btn-ghost btn-ghost--sm" onClick={() => onApply(true)}>
            Pop
          </button>
          <button className="btn-ghost btn-ghost--sm is-danger-text" onClick={onDrop}>
            Delete
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon.Close size={16} />
          </button>
        </div>

        <div className="stash-review__body">
          <div className="stash-review__files">
            {files === null ? (
              <div className="center-state">
                <div className="spinner" />
              </div>
            ) : files.length === 0 ? (
              <div className="list-empty">This stash has no file changes.</div>
            ) : (
              <WorkingFileList
                files={files}
                selectedPath={selected}
                onSelect={(path) => {
                  const file = files.find((f) => f.path === path)
                  if (file) loadDiff(file)
                }}
                contextMenuFor={(file) => [
                  {
                    label: 'Copy Path',
                    icon: <Icon.Copy size={15} />,
                    onClick: () => window.gitgrove.clipboardWrite(file.path)
                  }
                ]}
              />
            )}
          </div>
          <div className="stash-review__diff">
            <DiffViewer
              diff={diff}
              loading={diffLoading}
              mode={mode}
              wrap={wrap}
              theme={theme}
              onModeChange={setMode}
              onWrapChange={setWrap}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
