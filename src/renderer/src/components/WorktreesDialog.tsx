// Worktree manager: list the repo's working trees, open one as the current
// repo, add a new one (existing or new branch into a sibling folder), and
// remove linked trees. The main working tree can't be removed.

import type { WorktreeInfo } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { prettyPath } from '../lib/format'
import { Icon } from '../lib/icons'
import { ConfirmDialog, DialogShell, validateRefName } from './Dialog'

interface Props {
  repoPath: string
  /** Local branches, to validate the "existing branch" field quickly. */
  localBranches: string[]
  onOpenRepo: (path: string) => void
  onError: (e: unknown) => void
  onClose: () => void
}

export function WorktreesDialog({ repoPath, localBranches, onOpenRepo, onError, onClose }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<WorktreeInfo | null>(null)
  const [adding, setAdding] = useState(false)
  const [branch, setBranch] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setWorktrees(await window.gitgrove.worktreeList(repoPath))
    } catch (e) {
      onError(e)
      onClose()
    }
  }, [repoPath, onError, onClose])

  useEffect(() => {
    reload()
  }, [reload])

  const add = async () => {
    const name = branch.trim()
    const isExisting = localBranches.includes(name)
    if (!isExisting) {
      const err = validateRefName(name)
      if (err) {
        setAddError(err)
        return
      }
    }
    const parent = await window.gitgrove.pickDirectory('Folder to create the worktree in')
    if (!parent) return
    const dir = `${parent}/${name.replace(/\//g, '-')}`
    setBusy(true)
    try {
      await window.gitgrove.worktreeAdd(
        repoPath,
        dir,
        isExisting ? { branch: name } : { newBranch: name }
      )
      setAdding(false)
      setBranch('')
      await reload()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (force: boolean) => {
    if (!confirmRemove) return
    const target = confirmRemove
    setConfirmRemove(null)
    setBusy(true)
    try {
      await window.gitgrove.worktreeRemove(repoPath, target.path, { force })
      await reload()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Worktrees"
      icon={<Icon.Worktree size={22} />}
      busy={busy}
      onClose={onClose}
      width={560}
    >
      <p className="trust__body" style={{ marginBottom: 10 }}>
        Each worktree is a separate checkout of this repository — work on two branches side by side
        without stashing.
      </p>

      {worktrees === null ? (
        <div className="center-state" style={{ padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="wt-list">
          {worktrees.map((wt) => (
            <div key={wt.path} className="wt-item">
              <span className="icon-muted" style={{ display: 'flex' }}>
                <Icon.Worktree size={16} />
              </span>
              <div className="wt-item__main">
                <span className="wt-item__branch">
                  {wt.branch ?? `detached @ ${wt.headShort}`}
                  {wt.isMain && <span className="tag tag--current">main worktree</span>}
                  {wt.isCurrent && <span className="tag tag--current">open</span>}
                </span>
                <span className="wt-item__path" data-tip={wt.path} data-tip-overflow="">
                  {prettyPath(wt.path)}
                </span>
              </div>
              <div className="wt-item__actions">
                {!wt.isCurrent && (
                  <button
                    className="section-head__action"
                    disabled={busy}
                    data-tip="Open this worktree in GitGrove"
                    onClick={() => {
                      onClose()
                      onOpenRepo(wt.path)
                    }}
                  >
                    Open
                  </button>
                )}
                {!wt.isMain && (
                  <button
                    className="section-head__action is-danger"
                    disabled={busy || wt.isCurrent}
                    data-tip={wt.isCurrent ? 'Cannot remove the open worktree' : 'Remove worktree'}
                    onClick={() => setConfirmRemove(wt)}
                  >
                    <Icon.Trash size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="dlg-field" style={{ marginTop: 12 }}>
          <label htmlFor="wt-branch">Branch (existing or new)</label>
          <div className="dlg-pickrow">
            <input
              id="wt-branch"
              autoFocus
              placeholder="feature/my-branch"
              value={branch}
              disabled={busy}
              onChange={(e) => {
                setAddError(null)
                setBranch(e.target.value)
              }}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button
              className="btn-primary btn-primary--sm"
              onClick={add}
              disabled={busy || !branch.trim()}
            >
              Choose folder…
            </button>
          </div>
          {addError && <p className="dlg-error">{addError}</p>}
        </div>
      ) : (
        <div className="trust__actions" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn-ghost btn-ghost--sm"
            onClick={() => setAdding(true)}
            disabled={busy}
          >
            <Icon.Plus size={14} /> Add worktree…
          </button>
          <button className="btn-primary btn-primary--sm" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove worktree?"
          danger
          body={
            <>
              This removes the worktree at <code>{prettyPath(confirmRemove.path)}</code>.
              Uncommitted changes in it are lost; the branch itself is kept.
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => remove(true)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </DialogShell>
  )
}
