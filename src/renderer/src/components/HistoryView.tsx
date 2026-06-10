import type { ChangedFile, Commit } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { parseRefs, pluralize } from '../lib/format'
import { Icon } from '../lib/icons'
import { usePersistentState } from '../lib/persist'
import { useSpinDelay } from '../lib/useSpinDelay'
import { Avatar } from './Avatar'
import { RefChip } from './CommitSummary'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { copyPathItems } from './copyPathItems'
import { useFileFilter } from './FileFilter'
import { Resizer } from './Resizer'
import { WorkingFileList } from './WorkingFileList'

interface Props {
  repoPath: string
  commits: Commit[]
  loading: boolean
  selectedCommit: Commit | null
  onSelectCommit: (commit: Commit) => void
  commitFiles: ChangedFile[]
  commitFilesLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
  /** Reports the file-list selection size so the diff pane can show a
   *  "multiple files selected" state. */
  onFileSelectionChange?: (count: number) => void
  /** Right-click menu builder for a commit row (checkout, cherry-pick, reset, …). */
  commitMenuFor?: (commit: Commit) => ContextMenuItem[]
  /** Whether older commits exist past the loaded window (shows the sentinel). */
  hasMore?: boolean
  /** True while the next page is being fetched (bottom spinner). */
  loadingMore?: boolean
  /** Called when the list scrolls near the bottom; the parent appends a page. */
  onLoadMore?: () => void
}

/** How many ref chips to show inline in the list before collapsing to "+N". */
const MAX_LIST_REFS = 2

export function HistoryView({
  repoPath,
  commits,
  loading,
  selectedCommit,
  onSelectCommit,
  commitFiles,
  commitFilesLoading,
  selectedFilePath,
  onSelectFile,
  onFileSelectionChange,
  commitMenuFor,
  hasMore,
  loadingMore,
  onLoadMore
}: Props) {
  const [filesHeight, setFilesHeight] = usePersistentState('gg.historyFilesHeight', 360)
  // Commit files usually load in a few ms — render a quiet blank panel during
  // that window instead of flashing a spinner; the spinner is for slow loads.
  const filesSpin = useSpinDelay(commitFilesLoading)
  // Right-clicked commit: cursor position + menu items for that commit.
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  // Name + type filter over the selected commit's files (same UI as Changes;
  // history has no untracked entries). Cleared when another commit is picked.
  const {
    filtered: visibleFiles,
    query: filterQuery,
    active: filterActive,
    bar: filterBar,
    reset: resetFilter
  } = useFileFilter(commitFiles, ['added', 'modified', 'deleted', 'renamed'])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the commit switch is the intentional trigger
  useEffect(() => resetFilter(), [selectedCommit?.hash])
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

  // Infinite scroll: an IntersectionObserver on a sentinel row instead of an
  // onScroll handler — zero work per scrolled frame, fires once when the
  // sentinel enters the 600px pre-fetch margin so the next page is usually in
  // before the user reaches the end. `onLoadMore` lives in a ref so observer
  // setup never depends on the callback's identity.
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observing per appended page is the point — a new observer reports the current intersection immediately, which keeps paging until the sentinel leaves the margin (fills tall viewports with no scroll event at all).
  useEffect(() => {
    const root = listRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current?.()
      },
      { root, rootMargin: '0px 0px 600px 0px' }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasMore, commits.length])

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
      <div className="commit-list" ref={listRef}>
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
              onContextMenu={
                commitMenuFor
                  ? (e) => {
                      e.preventDefault()
                      onSelectCommit(commit)
                      setMenu({ x: e.clientX, y: e.clientY, items: commitMenuFor(commit) })
                    }
                  : undefined
              }
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
        {hasMore && (
          <div ref={sentinelRef} className="commit-list__more" aria-hidden="true">
            {loadingMore && <div className="spinner spinner--sm" />}
          </div>
        )}
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
              {commitFilesLoading
                ? filesSpin
                  ? 'Loading…'
                  : ' '
                : filterActive
                  ? `${visibleFiles.length} of ${commitFiles.length}`
                  : pluralize(commitFiles.length, 'file')}
            </div>
            {!commitFilesLoading && commitFiles.length > 0 && filterBar}
            <div className="tree-wrap">
              {commitFilesLoading ? (
                filesSpin && (
                  <div className="center-state">
                    <div className="spinner" />
                  </div>
                )
              ) : commitFiles.length === 0 ? (
                <div className="list-empty">No file changes in this commit.</div>
              ) : visibleFiles.length === 0 ? (
                <div className="list-empty">No files match the filter.</div>
              ) : (
                <WorkingFileList
                  key={selectedCommit.hash}
                  files={visibleFiles}
                  selectedPath={selectedFilePath}
                  // Read-only list: deselecting everything keeps the last diff.
                  onSelect={(path) => path !== null && onSelectFile(path)}
                  highlight={filterQuery}
                  onSelectionChange={onFileSelectionChange}
                  contextMenuFor={(selected) => copyPathItems(selected, repoPath)}
                />
              )}
            </div>
          </div>
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
