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
import { copyPathItems } from '@/components/common/copyPathItems'
import { type DiffMode, DiffViewer } from '@/components/common/DiffViewer'
import { useFileFilter } from '@/components/common/FileFilter'
import { Resizer } from '@/components/common/Resizer'
import { WorkingFileList } from '@/components/common/WorkingFileList'
import { pluralize, stashLabel } from '@/lib/format'
import { Icon } from '@/lib/icons'
import { usePersistentState } from '@/lib/persist'
import type { ResolvedTheme } from '@/lib/theme'

const NO_FILES: ChangedFile[] = []

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
  const [selCount, setSelCount] = useState(1)
  const [filesWidth, setFilesWidth] = usePersistentState('gg.stashFilesWidth', 300)
  const filesRef = useRef<HTMLDivElement>(null)
  const diffReq = useRef(0)

  // Name + type filter over the stash's files — same UI/behaviour as the
  // Changes and History lists.
  const {
    filtered: visibleFiles,
    query: filterQuery,
    active: filterActive,
    bar: filterBar
  } = useFileFilter(files ?? NO_FILES)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadDiff = (file: ChangedFile) => {
    // Stash diffs are immutable — re-clicking the focused file would only
    // reload the identical payload and flash the pane.
    if (file.path === selected && diff?.path === file.path) return
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
            <h2>{stashLabel(stash)}</h2>
            <span>
              {stash.relativeDate}
              {files
                ? ` · ${filterActive ? `${visibleFiles.length} of ${files.length}` : pluralize(files.length, 'file')}`
                : ''}
            </span>
          </div>
          {/* Auto-stashes (changes left behind while switching) only restore:
              applying while keeping the entry would leave a stale welcome-back
              reminder promising changes that are already back. */}
          {stash.auto ? (
            <button
              className="btn-ghost btn-ghost--sm"
              data-tip="Apply and clear the stash"
              onClick={() => onApply(true)}
            >
              Restore
            </button>
          ) : (
            <>
              <button className="btn-ghost btn-ghost--sm" onClick={() => onApply(false)}>
                Apply
              </button>
              <button className="btn-ghost btn-ghost--sm" onClick={() => onApply(true)}>
                Pop
              </button>
            </>
          )}
          <button className="btn-ghost btn-ghost--sm is-danger-text" onClick={onDrop}>
            Delete
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon.Close size={16} />
          </button>
        </div>

        <div className="stash-review__body">
          <div className="stash-review__files" ref={filesRef} style={{ width: filesWidth }}>
            {files === null ? (
              <div className="center-state">
                <div className="spinner" />
              </div>
            ) : files.length === 0 ? (
              <div className="list-empty">This stash has no file changes.</div>
            ) : (
              <>
                {filterBar}
                {visibleFiles.length === 0 ? (
                  <div className="list-empty">No files match the filter.</div>
                ) : (
                  <WorkingFileList
                    files={visibleFiles}
                    selectedPath={selected}
                    onSelect={(path) => {
                      const file = files.find((f) => f.path === path)
                      if (file) loadDiff(file)
                    }}
                    highlight={filterQuery}
                    onSelectionChange={setSelCount}
                    contextMenuFor={(sel) => copyPathItems(sel, repoPath)}
                  />
                )}
              </>
            )}
          </div>
          <Resizer
            orientation="x"
            size={filesWidth}
            min={200}
            max={560}
            onPreview={(w) => {
              if (filesRef.current) filesRef.current.style.width = `${w}px`
            }}
            onCommit={setFilesWidth}
          />
          <div className="stash-review__diff">
            <DiffViewer
              diff={diff}
              loading={diffLoading}
              mode={mode}
              wrap={wrap}
              theme={theme}
              selectedCount={selCount}
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
