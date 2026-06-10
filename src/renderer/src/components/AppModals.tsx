// App-level modal dialogs: branch create/rename/delete, tag, reset, revert,
// detached checkout, interactive rebase, worktrees, submodules and stash-all.
// App owns which modal is open (the `Modal` union); this component only
// renders the active one and wires its confirm action. Ops run through
// `runModalOp` (spinner while running, dialog closes either way, failures
// surface as the standard toast) unless a modal needs custom flow (delete's
// force escalation, checkout's log reload) — those come in as callbacks.

import type { BranchInfo, Commit, ResetMode } from '@shared/types'
import { ConfirmDialog, PromptDialog, validateRefName } from './Dialog'
import { InteractiveRebaseDialog } from './InteractiveRebaseDialog'
import { SubmodulesDialog } from './SubmodulesDialog'
import { WorktreesDialog } from './WorktreesDialog'

/** App-level modal dialogs (branch/tag/reset/rebase/clone/worktrees/…). */
export type Modal =
  | { kind: 'clone' }
  | { kind: 'new-branch'; from?: string; fromLabel?: string; initialName?: string }
  | { kind: 'rename-branch'; name: string }
  | { kind: 'delete-branch'; name: string; force: boolean }
  | { kind: 'create-tag'; hash: string; shortHash: string }
  | { kind: 'reset'; hash: string; shortHash: string; mode: ResetMode }
  | { kind: 'revert'; hash: string; shortHash: string }
  | { kind: 'checkout-commit'; hash: string; shortHash: string }
  | { kind: 'irebase'; commits: Commit[]; base: string }
  | { kind: 'worktrees' }
  | { kind: 'submodules' }
  | { kind: 'stash' }

interface Props {
  /** The active modal. 'clone' is rendered by App (it works without a repo). */
  modal: Exclude<Modal, { kind: 'clone' }>
  repoPath: string
  branch: BranchInfo | null
  busy: boolean
  /** Run a modal-confirmed op: spinner, close, errors → toast. */
  runModalOp: (fn: () => Promise<unknown>) => Promise<void>
  /** Delete a branch; owns the "not fully merged" force escalation. */
  onDeleteBranch: (name: string, force: boolean) => Promise<void>
  /** Detached checkout; owns the follow-up log reload. */
  onCheckoutCommit: (hash: string) => Promise<void>
  onOpenRepo: (path: string) => void
  onError: (e: unknown) => void
  onClose: () => void
}

export function AppModals({
  modal,
  repoPath,
  branch,
  busy,
  runModalOp,
  onDeleteBranch,
  onCheckoutCommit,
  onOpenRepo,
  onError,
  onClose
}: Props) {
  const gg = window.gitgrove
  switch (modal.kind) {
    case 'new-branch':
      return (
        <PromptDialog
          title={modal.from ? `New branch at ${modal.fromLabel}` : 'New branch'}
          confirmLabel="Create branch"
          busy={busy}
          fields={[
            {
              key: 'name',
              label: 'Branch name',
              placeholder: 'feature/my-change',
              initial: modal.initialName,
              validate: validateRefName
            },
            {
              key: 'checkout',
              label: 'Check out the new branch',
              checkbox: true,
              initialChecked: true
            }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              gg.createBranch(repoPath, values.name.trim(), {
                from: modal.from,
                checkout: checks.checkout
              })
            )
          }
          onCancel={onClose}
        />
      )
    case 'rename-branch':
      return (
        <PromptDialog
          title={`Rename ${modal.name}`}
          confirmLabel="Rename"
          busy={busy}
          fields={[
            { key: 'name', label: 'New name', initial: modal.name, validate: validateRefName }
          ]}
          onSubmit={(values) =>
            runModalOp(() => gg.renameBranch(repoPath, modal.name, values.name.trim()))
          }
          onCancel={onClose}
        />
      )
    case 'delete-branch':
      return (
        <ConfirmDialog
          title={`Delete ${modal.name}?`}
          danger
          busy={busy}
          body={
            modal.force ? (
              <>
                <code>{modal.name}</code> has commits that aren't merged anywhere else. Deleting it
                will lose them (recoverable from the reflog for a while).
              </>
            ) : (
              <>
                The local branch <code>{modal.name}</code> will be deleted. Its remote
                counterpart, if any, is untouched.
              </>
            )
          }
          confirmLabel={modal.force ? 'Force delete' : 'Delete'}
          onConfirm={() => onDeleteBranch(modal.name, modal.force)}
          onCancel={onClose}
        />
      )
    case 'create-tag':
      return (
        <PromptDialog
          title={`Tag commit ${modal.shortHash}`}
          confirmLabel="Create tag"
          busy={busy}
          fields={[
            { key: 'name', label: 'Tag name', placeholder: 'v1.2.0', validate: validateRefName },
            { key: 'message', label: 'Message (annotated tag, optional)' },
            { key: 'push', label: 'Push tag to remote', checkbox: true, initialChecked: false }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              gg.createTag(repoPath, values.name.trim(), {
                hash: modal.hash,
                message: values.message,
                push: checks.push
              })
            )
          }
          onCancel={onClose}
        />
      )
    case 'reset':
      return (
        <ConfirmDialog
          title={`Hard reset to ${modal.shortHash}?`}
          danger
          busy={busy}
          body={
            <>
              <code>{branch?.current}</code> will point at <code>{modal.shortHash}</code> and{' '}
              <strong>all uncommitted changes are discarded</strong>. Commits left behind stay in
              the reflog for a while.
            </>
          }
          confirmLabel="Hard reset"
          onConfirm={() => runModalOp(() => gg.reset(repoPath, modal.hash, modal.mode))}
          onCancel={onClose}
        />
      )
    case 'revert':
      return (
        <ConfirmDialog
          title={`Revert ${modal.shortHash}?`}
          busy={busy}
          body="A new commit will be created that undoes this commit's changes. Your working tree must be clean enough for the revert to apply."
          confirmLabel="Revert"
          onConfirm={() => runModalOp(() => gg.revertCommit(repoPath, modal.hash))}
          onCancel={onClose}
        />
      )
    case 'checkout-commit':
      return (
        <ConfirmDialog
          title={`Checkout ${modal.shortHash}?`}
          busy={busy}
          body="This detaches HEAD: you can look around and build, but new commits won't belong to any branch until you create one. Switch back to a branch to return to normal."
          confirmLabel="Checkout"
          onConfirm={() => onCheckoutCommit(modal.hash)}
          onCancel={onClose}
        />
      )
    case 'irebase':
      return (
        <InteractiveRebaseDialog
          commits={modal.commits}
          base={modal.base}
          busy={busy}
          onSubmit={(items) => runModalOp(() => gg.rebaseInteractive(repoPath, modal.base, items))}
          onCancel={onClose}
        />
      )
    case 'worktrees':
      return (
        <WorktreesDialog
          repoPath={repoPath}
          localBranches={branch?.local ?? []}
          onOpenRepo={onOpenRepo}
          onError={onError}
          onClose={onClose}
        />
      )
    case 'submodules':
      return (
        <SubmodulesDialog
          repoPath={repoPath}
          onOpenRepo={onOpenRepo}
          onError={onError}
          onClose={onClose}
        />
      )
    case 'stash':
      return (
        <PromptDialog
          title="Stash all changes"
          confirmLabel="Stash"
          busy={busy}
          fields={[
            { key: 'message', label: 'Message (optional)' },
            {
              key: 'untracked',
              label: 'Include untracked files',
              checkbox: true,
              initialChecked: true
            }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              gg.stashSave(repoPath, {
                message: values.message,
                includeUntracked: checks.untracked
              })
            )
          }
          onCancel={onClose}
        />
      )
  }
}
