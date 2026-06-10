// The Changes sidebar: one list of changed files with commit-selection
// checkboxes (a master checkbox includes/excludes everything), an operation
// banner while a merge/rebase/cherry-pick/revert is in flight, stash access,
// and the commit composer. Checkboxes are pure renderer state (the GitHub
// Desktop model) — git is only touched at commit time. Destructive actions
// still go through `runOp` (serialized, auto-refresh, errors → toast).

import type { ChangedFile, RepoState, StashEntry } from '@shared/types'
import type { FileSelection } from './DiffViewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pluralize } from '../lib/format'
import { Icon } from '../lib/icons'
import type { ResolvedTheme } from '../lib/theme'
import { CommitComposer } from './CommitComposer'
import type { ContextMenuItem } from './ContextMenu'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { useFileFilter } from './FileFilter'
import { Popover } from './Popover'
import { StashReviewDialog } from './StashReviewDialog'
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
  onSelectFile: (path: string) => void
  /** Commit selection per path; missing key = fully included. */
  selections: ReadonlyMap<string, FileSelection>
  /** Toggle one file's inclusion in the next commit (pure renderer state). */
  onToggleFile: (path: string) => void
  /** Master checkbox: include/exclude everything (or just `paths` when filtering). */
  onSetAllIncluded: (included: boolean, paths?: string[]) => void
  /** On-disk size of the included files (bytes), or null while unknown. */
  commitSize: number | null
  /** Resolved theme, for the stash review dialog's diff. */
  theme: ResolvedTheme
  /** Run a mutating op (serialized, auto-refresh, errors → toast). True on success. */
  runOp: (fn: () => Promise<unknown>) => Promise<boolean>
  onCommit: (message: string, amend: boolean) => Promise<boolean>
}

const OP_LABEL: Record<NonNullable<RepoState['op']>, string> = {
  merging: 'Merge in progress',
  rebasing: 'Rebase in progress',
  'cherry-picking': 'Cherry-pick in progress',
  reverting: 'Revert in progress'
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
  selections,
  onToggleFile,
  onSetAllIncluded,
  commitSize,
  theme,
  runOp,
  onCommit
}: Props) {
  const gg = window.gitgrove

  // ── Filter (name substring + status types, shared with History) ───────────
  // The snapshot arrives path-sorted from the main process. Filtering and the
  // header stats are each a single memoized pass, so a 90k-entry list stays
  // cheap per refresh.
  const { filtered: files, active: filterActive, bar: filterBar } = useFileFilter(changes)

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
  const [stashOpen, setStashOpen] = useState(false)
  const [stashPrompt, setStashPrompt] = useState(false)
  const [reviewStash, setReviewStash] = useState<StashEntry | null>(null)
  const stashAnchor = useRef<HTMLButtonElement>(null)

  // Commit mode (Commit | Amend) — lives in the stash row, drives the composer.
  const [amend, setAmend] = useState(false)
  const [committing, setCommitting] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: repoPath is the intentional reset trigger
  useEffect(() => setAmend(false), [repoPath])

  const discard = async () => {
    if (!confirmDiscard) return
    const tracked = confirmDiscard.files.filter((f) => f.status !== 'untracked').map((f) => f.path)
    const untracked = confirmDiscard.files
      .filter((f) => f.status === 'untracked')
      .map((f) => f.path)
    setConfirmDiscard(null)
    await runOp(() => gg.discardFiles(repoPath, tracked, untracked))
  }

  const confirmDiscardAll = () =>
    setConfirmDiscard({
      files: files.filter((f) => f.status !== 'conflicted'),
      all: true
    })

  const contextMenuFor = (file: ChangedFile): ContextMenuItem[] => {
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
        {
          label: 'Copy Path',
          icon: <Icon.Copy size={15} />,
          onClick: () => gg.clipboardWrite(file.path)
        }
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
      {
        label: 'Open in Editor',
        icon: <Icon.External size={15} />,
        onClick: () => gg.openFileInEditor(repoPath, file.path)
      },
      {
        label: 'Copy Path',
        icon: <Icon.Copy size={15} />,
        onClick: () => gg.clipboardWrite(file.path)
      }
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
                files={files}
                selections={selections}
                selectedPath={selectedPath}
                onSelect={onSelectFile}
                onToggleIncluded={onToggleFile}
                contextMenuFor={contextMenuFor}
              />
            )}
          </>
        )}
      </div>

      <div className="changes__stash-row">
        <button
          ref={stashAnchor}
          className="stash-chip"
          disabled={busy}
          data-tip={stashes.length > 0 ? 'Stashes' : 'No stashes yet'}
          onClick={() => (stashes.length > 0 ? setStashOpen(true) : setStashPrompt(true))}
        >
          <Icon.Stash size={14} />
          {stashes.length > 0
            ? pluralize(stashes.length, 'stash').replace('stashs', 'stashes')
            : 'Stash'}
        </button>
        {files.length > 0 && (
          <button
            className="stash-chip"
            disabled={busy}
            data-tip="Stash all changes"
            onClick={() => setStashPrompt(true)}
          >
            <Icon.Plus size={13} /> Stash changes…
          </button>
        )}
        <span className="changes__stash-spacer" />
        <div className="segmented segmented--sm" role="radiogroup" aria-label="Commit mode">
          <button
            type="button"
            role="radio"
            aria-checked={!amend}
            className={amend ? '' : 'is-active'}
            disabled={busy || committing}
            data-tip={`Create a new commit on ${branch}`}
            onClick={() => setAmend(false)}
          >
            Commit
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={amend}
            className={amend ? 'is-active' : ''}
            disabled={busy || committing}
            data-tip="Replace the last commit with this one"
            onClick={() => setAmend(true)}
          >
            Amend
          </button>
        </div>
      </div>

      <CommitComposer
        repoPath={repoPath}
        branch={branch}
        includedCount={includedCount}
        commitSize={commitSize}
        busy={busy}
        amend={amend}
        onCommittingChange={setCommitting}
        onCommit={async (message, withAmend) => {
          const ok = await onCommit(message, withAmend)
          if (ok) setAmend(false)
          return ok
        }}
      />

      <Popover
        anchor={stashAnchor.current}
        open={stashOpen}
        onClose={() => setStashOpen(false)}
        width={320}
      >
        <div className="popover__group-label" style={{ position: 'static' }}>
          Stashes
        </div>
        <div className="stash-list">
          {stashes.map((s) => (
            <div key={s.index} className="stash-item">
              <button
                type="button"
                className="stash-item__main"
                data-tip="Review this stash"
                onClick={() => {
                  setStashOpen(false)
                  setReviewStash(s)
                }}
              >
                <span className="stash-item__msg" data-tip-overflow="">
                  {s.message || `stash@{${s.index}}`}
                </span>
                <span className="stash-item__date">{s.relativeDate}</span>
              </button>
              <div className="stash-item__actions">
                <button
                  className="section-head__action"
                  data-tip="Apply and keep"
                  onClick={() => {
                    setStashOpen(false)
                    runOp(() => gg.stashApply(repoPath, s.index, false))
                  }}
                >
                  Apply
                </button>
                <button
                  className="section-head__action"
                  data-tip="Apply and drop"
                  onClick={() => {
                    setStashOpen(false)
                    runOp(() => gg.stashApply(repoPath, s.index, true))
                  }}
                >
                  Pop
                </button>
                <button
                  className="section-head__action is-danger"
                  data-tip="Delete stash"
                  onClick={() => {
                    setStashOpen(false)
                    runOp(() => gg.stashDrop(repoPath, s.index))
                  }}
                >
                  <Icon.Trash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Popover>

      {reviewStash && (
        <StashReviewDialog
          repoPath={repoPath}
          stash={reviewStash}
          theme={theme}
          onApply={(pop) => {
            setReviewStash(null)
            runOp(() => gg.stashApply(repoPath, reviewStash.index, pop))
          }}
          onDrop={() => {
            setReviewStash(null)
            runOp(() => gg.stashDrop(repoPath, reviewStash.index))
          }}
          onClose={() => setReviewStash(null)}
        />
      )}

      {stashPrompt && (
        <PromptDialog
          title="Stash all changes"
          confirmLabel="Stash"
          fields={[
            {
              key: 'message',
              label: 'Message (optional)',
              placeholder: 'What were you working on?'
            },
            {
              key: 'untracked',
              label: 'Include untracked files',
              checkbox: true,
              initialChecked: true
            }
          ]}
          onSubmit={(values, checks) => {
            setStashPrompt(false)
            runOp(() =>
              gg.stashSave(repoPath, {
                message: values.message,
                includeUntracked: checks.untracked
              })
            )
          }}
          onCancel={() => setStashPrompt(false)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title={confirmDiscard.all ? 'Discard all changes?' : 'Discard changes?'}
          danger
          body={
            <>
              {confirmDiscard.all ? (
                <>
                  This will discard the unstaged changes in{' '}
                  {pluralize(confirmDiscard.files.length, 'file')}.{' '}
                </>
              ) : (
                <>
                  This will discard the changes in{' '}
                  <code>{confirmDiscard.files[0]?.path}</code>.{' '}
                </>
              )}
              Tracked files are restored from the index; untracked files move to the system trash.
            </>
          }
          confirmLabel="Discard"
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  )
}
