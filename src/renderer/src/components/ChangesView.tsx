// The Changes sidebar: one list of changed files with commit-selection
// checkboxes (a master checkbox includes/excludes everything), an operation
// banner while a merge/rebase/cherry-pick/revert is in flight, stash access,
// and the commit composer. Checkboxes are pure renderer state — git is only
// touched at commit time. Destructive actions still go through `runOp`
// (serialized, auto-refresh, errors → toast).

import type { ChangedFile, RepoState, StashEntry } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileSelection } from '../lib/commit-selection'
import { pluralize, statusLetter } from '../lib/format'
import { Icon } from '../lib/icons'
import { ignoreOptionsFor, ignoreSelectionOption } from '../lib/ignore'
import { usePersistentState } from '../lib/persist'
import type { ResolvedTheme } from '../lib/theme'
import { CommitComposer, type CommitMode } from './CommitComposer'
import type { ContextMenuItem } from './ContextMenu'
import { copyPathItems } from './copyPathItems'
import { ConfirmDialog } from './Dialog'
import { useFileFilter } from './FileFilter'
import { Popover } from './Popover'
import { Resizer } from './Resizer'
import { StashPanel } from './StashPanel'
import { WorkingFileList } from './WorkingFileList'

interface Props {
  repoPath: string
  branch: string
  changes: ChangedFile[]
  loading: boolean
  busy: boolean
  repoState: RepoState | null
  stashes: StashEntry[]
  selectedPath: string | null
  /** Focus change; null when the list selection was emptied. */
  onSelectFile: (path: string | null) => void
  /** Reports the file-list selection size so the diff pane can show a
   *  "multiple files selected" state. */
  onFileSelectionChange?: (count: number) => void
  /** Commit selection per path; missing key = fully included. */
  selections: ReadonlyMap<string, FileSelection>
  /** Toggle one file's inclusion in the next commit (pure renderer state). */
  onToggleFile: (path: string) => void
  /** Master checkbox: include/exclude everything (or just `paths` when filtering). */
  onSetAllIncluded: (included: boolean, paths?: string[]) => void
  /** On-disk size of the included files (bytes), or null while unknown. */
  commitSize: number | null
  /** Determinate 0–100 of a running discard, or null before/without one. */
  discardProgress: number | null
  /** Resolved theme, for the stash review dialog's diff. */
  theme: ResolvedTheme
  /** Run a mutating op (serialized, auto-refresh, errors → toast). True on success. */
  runOp: (fn: () => Promise<unknown>) => Promise<boolean>
  onCommit: (message: string, amend: boolean) => Promise<boolean>
  /** Stash the checked files (optional message). True on success. */
  onStash: (message: string) => Promise<boolean>
}

const OP_LABEL: Record<NonNullable<RepoState['op']>, string> = {
  merging: 'Merge in progress',
  rebasing: 'Rebase in progress',
  'cherry-picking': 'Cherry-pick in progress',
  reverting: 'Revert in progress'
}

/** Rows shown in the discard confirmation before collapsing to "+N more". */
const DISCARD_LIST_MAX = 250

/**
 * Discard confirmation body: exactly which files are about to be discarded
 * (scrollable, status-tinted), so a bulk discard is never a leap of faith —
 * and, once confirmed, a determinate bar while the discard runs.
 */
function DiscardSummary({
  files,
  all,
  progress
}: {
  files: ChangedFile[]
  all: boolean
  /** 0–100 while the discard runs; null before confirmation. */
  progress: number | null
}) {
  const untracked = files.filter((f) => f.status === 'untracked').length
  const overflow = files.length - DISCARD_LIST_MAX
  return (
    <>
      This will discard the {all ? 'unstaged ' : ''}changes in{' '}
      {files.length === 1 ? <code>{files[0].path}</code> : pluralize(files.length, 'file')}.
      <div className="discard-list" role="list">
        {files.slice(0, DISCARD_LIST_MAX).map((f) => (
          <div key={f.path} className="discard-list__row" role="listitem">
            <span className={`wfl__status st-${f.status}`}>{statusLetter(f.status)}</span>
            <span className="discard-list__path" title={f.path}>
              {f.path}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <div className="discard-list__more">…and {pluralize(overflow, 'more file')}</div>
        )}
      </div>
      {progress !== null ? (
        <div className="clone-progress" role="status">
          <div className="clone-progress__bar">
            <div
              className="clone-progress__fill"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
          <span className="clone-progress__label">Discarding… {progress}%</span>
        </div>
      ) : untracked > 0 ? (
        `Tracked files are restored from the last commit; ${
          untracked === files.length
            ? 'untracked files move'
            : `the ${pluralize(untracked, 'untracked file')} moves`
        } to the system trash, so this is recoverable.`
      ) : (
        'Files are restored to their state in the last commit.'
      )}
    </>
  )
}

export function ChangesView({
  repoPath,
  branch,
  changes,
  loading,
  busy,
  repoState,
  stashes,
  selectedPath,
  onSelectFile,
  onFileSelectionChange,
  selections,
  onToggleFile,
  onSetAllIncluded,
  commitSize,
  discardProgress,
  theme,
  runOp,
  onCommit,
  onStash
}: Props) {
  const gg = window.gitgrove

  // ── Filter (name substring + status types, shared with History) ───────────
  // The snapshot arrives path-sorted from the main process. Filtering and the
  // header stats are each a single memoized pass, so a 90k-entry list stays
  // cheap per refresh.
  const {
    filtered: files,
    query: filterQuery,
    active: filterActive,
    bar: filterBar
  } = useFileFilter(changes)

  const stats = useMemo(() => {
    let includedCount = 0
    let selectables = 0
    let fullyIncluded = 0
    let discardables = 0
    for (const f of files) {
      if (f.status !== 'conflicted') {
        selectables++
        const sel = selections.get(f.path) ?? 'all'
        if (sel !== 'none') includedCount++
        if (sel === 'all') fullyIncluded++
        discardables++
      }
    }
    return {
      includedCount,
      hasSelectables: selectables > 0,
      allIncluded: selectables > 0 && fullyIncluded === selectables,
      discardables
    }
  }, [files, selections])
  const { includedCount, hasSelectables, allIncluded } = stats

  const [confirmDiscard, setConfirmDiscard] = useState<{
    files: ChangedFile[]
    all: boolean
  } | null>(null)

  // Composer mode (Commit | Amend | Stash): the action button is a split
  // button whose caret half opens this popover to switch modes.
  const [mode, setMode] = useState<CommitMode>('commit')
  const [modeOpen, setModeOpen] = useState(false)
  const modeAnchor = useRef<HTMLButtonElement>(null)
  const [committing, setCommitting] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: repoPath is the intentional reset trigger
  useEffect(() => setMode('commit'), [repoPath])

  const modeMeta = {
    commit: { label: 'Commit', sub: `Create a new commit on ${branch}`, MIcon: Icon.Check },
    amend: { label: 'Amend', sub: 'Replace the last commit with this one', MIcon: Icon.Pencil },
    stash: { label: 'Stash', sub: 'Set the checked files aside for later', MIcon: Icon.Stash }
  } as const

  // Height of the composer's description box, driven by the splitter above
  // the composer (the only stretchy part — everything else is fixed, so the
  // panel never jumps when switching modes). Live drags write to the DOM
  // node directly; state commits on release and persists across sessions.
  const [storedDescHeight, setDescHeight] = usePersistentState('gg.composerDescHeight', 96)
  const descHeight = Math.min(300, Math.max(30, storedDescHeight))
  const descEl = useRef<HTMLTextAreaElement | null>(null)

  // True while a confirmed discard runs — the dialog stays open showing the
  // determinate progress bar instead of vanishing into a frozen list.
  const [discarding, setDiscarding] = useState(false)

  const discard = async () => {
    if (!confirmDiscard) return
    // Tracked files carry oldPath/status so the main process can restore
    // renames and staged-new files to their HEAD state (see IPC.discardFiles).
    const tracked = confirmDiscard.files
      .filter((f) => f.status !== 'untracked')
      .map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status }))
    const untracked = confirmDiscard.files
      .filter((f) => f.status === 'untracked')
      .map((f) => f.path)
    setDiscarding(true)
    try {
      await runOp(() => gg.discardFiles(repoPath, tracked, untracked))
    } finally {
      setDiscarding(false)
      setConfirmDiscard(null)
    }
  }

  const confirmDiscardAll = () =>
    setConfirmDiscard({
      files: files.filter((f) => f.status !== 'conflicted'),
      all: true
    })

  // Full (unfiltered) untracked list, so the Ignore menu counts reflect the
  // repo, not the current filter.
  const untrackedPaths = useMemo(
    () => changes.filter((f) => f.status === 'untracked').map((f) => f.path),
    [changes]
  )

  /** Ignore menu rows: each label names exactly what it hides (file, all
   *  same-extension files, folder) — no surprises, no dialog. The
   *  watcher-driven refresh makes the files vanish and `.gitignore` itself
   *  appear as a change, so the action is self-explaining and trivially
   *  undoable. */
  const ignoreItemsFor = (file: ChangedFile): ContextMenuItem[] =>
    ignoreOptionsFor(file.path, untrackedPaths).map((o) => ({
      label: o.label,
      icon: <Icon.EyeOff size={15} />,
      onClick: () => runOp(() => gg.ignorePatterns(repoPath, o.patterns))
    }))

  /** Menu for the list selection: single file keeps the full menu; a
   *  multi-selection gets bulk include/exclude, discard and copy. */
  const contextMenuFor = (selected: ChangedFile[]): ContextMenuItem[] => {
    if (selected.length > 1) {
      const actionable = selected.filter((f) => f.status !== 'conflicted')
      const items: ContextMenuItem[] = []
      if (actionable.length > 0) {
        const allIncluded = actionable.every((f) => (selections.get(f.path) ?? 'all') !== 'none')
        items.push(
          allIncluded
            ? {
                label: 'Exclude from Commit',
                icon: <Icon.Minus size={15} />,
                onClick: () =>
                  onSetAllIncluded(
                    false,
                    actionable.map((f) => f.path)
                  )
              }
            : {
                label: 'Include in Commit',
                icon: <Icon.Plus size={15} />,
                onClick: () =>
                  onSetAllIncluded(
                    true,
                    actionable.map((f) => f.path)
                  )
              },
          {
            label: 'Discard Changes…',
            icon: <Icon.Undo size={15} />,
            danger: true,
            onClick: () => setConfirmDiscard({ files: actionable, all: false })
          },
          {}
        )
      }
      const untracked = selected.filter((f) => f.status === 'untracked')
      if (untracked.length > 0) {
        const option = ignoreSelectionOption(untracked.map((f) => f.path), selected.length)
        items.push(
          {
            label: option.label,
            icon: <Icon.EyeOff size={15} />,
            onClick: () => runOp(() => gg.ignorePatterns(repoPath, option.patterns))
          },
          {}
        )
      }
      items.push(...copyPathItems(selected, repoPath))
      return items
    }
    const file = selected[0]
    if (!file) return []
    if (file.status === 'conflicted') {
      return [
        {
          label: 'Resolve Using Ours',
          icon: <Icon.Check size={15} />,
          onClick: () => runOp(() => gg.resolveConflict(repoPath, file.path, 'ours'))
        },
        {
          label: 'Resolve Using Theirs',
          icon: <Icon.Check size={15} />,
          onClick: () => runOp(() => gg.resolveConflict(repoPath, file.path, 'theirs'))
        },
        {
          label: 'Mark as Resolved',
          icon: <Icon.Plus size={15} />,
          onClick: () => runOp(() => gg.markResolved(repoPath, file.path))
        },
        {},
        {
          label: 'Open in Editor',
          icon: <Icon.External size={15} />,
          onClick: () => gg.openFileInEditor(repoPath, file.path)
        },
        {},
        ...copyPathItems([file], repoPath)
      ]
    }
    const included = (selections.get(file.path) ?? 'all') !== 'none'
    return [
      included
        ? {
            label: 'Exclude from Commit',
            icon: <Icon.Minus size={15} />,
            onClick: () => onToggleFile(file.path)
          }
        : {
            label: 'Include in Commit',
            icon: <Icon.Plus size={15} />,
            onClick: () => onToggleFile(file.path)
          },
      {
        label: file.status === 'untracked' ? 'Move to Trash…' : 'Discard Changes…',
        icon: <Icon.Undo size={15} />,
        danger: true,
        onClick: () => setConfirmDiscard({ files: [file], all: false })
      },
      {},
      ...(file.status === 'untracked' ? [...ignoreItemsFor(file), {}] : []),
      {
        label: 'Open in Editor',
        icon: <Icon.External size={15} />,
        onClick: () => gg.openFileInEditor(repoPath, file.path)
      },
      {},
      ...copyPathItems([file], repoPath)
    ]
  }

  const op = repoState?.op
  const conflicts = repoState?.conflictedCount ?? 0

  return (
    <div className="changes">
      {op && (
        <div className="op-banner" role="status">
          <div className="op-banner__text">
            <strong>{OP_LABEL[op]}</strong>
            <span>
              {conflicts > 0
                ? `${pluralize(conflicts, 'conflicted file')} — resolve them, then continue.`
                : (repoState?.detail ?? 'All conflicts resolved — ready to continue.')}
            </span>
          </div>
          <div className="op-banner__actions">
            <button
              className="btn-primary btn-primary--sm"
              disabled={busy || conflicts > 0}
              data-tip={conflicts > 0 ? 'Resolve all conflicts first' : undefined}
              onClick={() => runOp(() => gg.continueOp(repoPath, op))}
            >
              Continue
            </button>
            {op === 'rebasing' && (
              <button
                className="btn-ghost btn-ghost--sm"
                disabled={busy}
                data-tip="Skip the current commit"
                onClick={() => runOp(() => gg.skipRebaseCommit(repoPath))}
              >
                Skip
              </button>
            )}
            <button
              className="btn-ghost btn-ghost--sm"
              disabled={busy}
              onClick={() => runOp(() => gg.abortOp(repoPath, op))}
            >
              Abort
            </button>
          </div>
        </div>
      )}

      <div className="changes__list">
        {loading && changes.length === 0 ? (
          <div className="center-state">
            <div className="spinner" />
          </div>
        ) : changes.length === 0 ? (
          <div className="center-state">
            <div className="icon-ring">
              <Icon.Check size={22} />
            </div>
            <h3>Working tree clean</h3>
            <p>There are no uncommitted changes. Switch to History to browse past commits.</p>
          </div>
        ) : (
          <>
            <div className="section-head">
              <input
                type="checkbox"
                className="wfl__check"
                checked={allIncluded}
                ref={(el) => {
                  if (el) el.indeterminate = !allIncluded && includedCount > 0
                }}
                disabled={busy || !hasSelectables}
                data-tip={allIncluded ? 'Exclude all from commit' : 'Include all in commit'}
                onChange={() =>
                  onSetAllIncluded(
                    !allIncluded,
                    filterActive
                      ? files.filter((f) => f.status !== 'conflicted').map((f) => f.path)
                      : undefined
                  )
                }
              />
              <span className="section-head__label">
                {filterActive
                  ? `${files.length} of ${changes.length}`
                  : pluralize(files.length, 'file')}
              </span>
              <span className="section-head__spacer" />
              {stats.discardables > 0 && (
                <button
                  className="section-head__action is-danger"
                  disabled={busy}
                  data-tip="Discard all unstaged changes"
                  onClick={confirmDiscardAll}
                >
                  <Icon.Undo size={13} />
                </button>
              )}
            </div>
            {filterBar}
            {files.length === 0 ? (
              <div className="list-empty">No changes match the filter.</div>
            ) : (
              <WorkingFileList
                key={repoPath}
                files={files}
                selections={selections}
                selectedPath={selectedPath}
                onSelect={onSelectFile}
                onToggleIncluded={onToggleFile}
                onSetIncluded={(paths, included) => onSetAllIncluded(included, paths)}
                highlight={filterQuery}
                onSelectionChange={onFileSelectionChange}
                contextMenuFor={contextMenuFor}
              />
            )}
          </>
        )}
      </div>

      <Resizer
        orientation="y"
        invert
        size={descHeight}
        min={30}
        max={300}
        onPreview={(h) => {
          if (descEl.current) descEl.current.style.height = `${h}px`
        }}
        onCommit={setDescHeight}
      />
      <StashPanel repoPath={repoPath} stashes={stashes} busy={busy} theme={theme} runOp={runOp} />

      <Popover
        anchor={modeAnchor.current}
        open={modeOpen}
        onClose={() => setModeOpen(false)}
        width={250}
      >
        <div className="popover__list">
          <div className="popover__group-label">Mode</div>
          {(['commit', 'amend', 'stash'] as const).map((m) => {
            const { label, sub, MIcon } = modeMeta[m]
            return (
              <button
                key={m}
                className={`popover__item${mode === m ? ' is-active' : ''}`}
                onClick={() => {
                  setMode(m)
                  setModeOpen(false)
                }}
              >
                <span className="icon-muted">
                  <MIcon size={15} />
                </span>
                <span className="popover__item-main">
                  <span className="popover__item-title">{label}</span>
                  <span className="popover__item-sub">{sub}</span>
                </span>
                {mode === m && (
                  <span className="icon-muted" style={{ color: 'var(--accent)' }}>
                    <Icon.Check size={15} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Popover>

      <CommitComposer
        repoPath={repoPath}
        branch={branch}
        includedCount={includedCount}
        commitSize={commitSize}
        busy={busy}
        mode={mode}
        descriptionHeight={descHeight}
        descriptionRef={(el) => {
          descEl.current = el
        }}
        modeMenuRef={(el) => {
          modeAnchor.current = el
        }}
        onOpenModeMenu={() => setModeOpen(true)}
        onCommittingChange={setCommitting}
        onCommit={async (message, withAmend) => {
          const ok = await onCommit(message, withAmend)
          if (ok) setMode('commit')
          return ok
        }}
        onStash={async (message) => {
          const ok = await onStash(message)
          if (ok) setMode('commit')
          return ok
        }}
      />

      {confirmDiscard && (
        <ConfirmDialog
          title={confirmDiscard.all ? 'Discard all changes?' : 'Discard changes?'}
          danger
          busy={discarding}
          body={
            <DiscardSummary
              files={confirmDiscard.files}
              all={confirmDiscard.all}
              progress={discarding ? (discardProgress ?? 0) : null}
            />
          }
          confirmLabel="Discard"
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  )
}
