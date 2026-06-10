// Registers every ipcMain handler — the main-process side of the IPC contract
// (`src/shared/ipc.ts`). Handlers are thin: argument plumbing into the git
// modules plus the few Electron-native services (dialogs, shell, clipboard,
// window controls). Anything with real logic lives in the modules it calls.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ChangedFile,
  CommitSelection,
  DiffArea,
  DiscardItem,
  GitAvailability,
  LogOptions,
  OpProgress,
  ProgressOpKind,
  RebaseTodoItem,
  RepoOpenResult,
  RepoOpKind,
  ResetMode
} from '@shared/types'
import { appInfo } from './app-info'
import {
  getBranches,
  getCommitDiff,
  getCommitFiles,
  getLog,
  getRemoteWebUrl,
  getWorkingDiff
} from './git/read'
import { rebaseInteractive } from './git/rebase'
import { getRepoSnapshot } from './git/status'
import * as gitSync from './git/sync'
import * as gitWrite from './git/write'
import { openTerminal } from './menu'
import { getRecentRepos, rememberRepo, removeRecentRepo } from './store'
import { checkForUpdates, quitAndInstall } from './updater'

/** What the handlers need from the app shell. */
export interface IpcContext {
  getWindow(): BrowserWindow | null
  openRepoAtPath(path: string): Promise<RepoOpenResult>
  trustRepo(path: string): Promise<RepoOpenResult>
  checkGit(force: boolean): Promise<GitAvailability>
}

export function registerIpc(ctx: IpcContext): void {
  const { getWindow, openRepoAtPath, trustRepo, checkGit } = ctx

  /**
   * Progress forwarder for a long-running op: pushes phase + percent to the
   * renderer so the matching button can fill determinately while git works.
   */
  const opProgressTo = (repoPath: string, kind: ProgressOpKind) => {
    return (phase: string, percent: number): void => {
      const progress: OpProgress = { repoPath, kind, phase, percent }
      getWindow()?.webContents.send(IPC.opProgress, progress)
    }
  }

  ipcMain.handle(IPC.pickRepo, async () => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Open Git Repository',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openRepoAtPath(result.filePaths[0])
  })

  ipcMain.handle(IPC.openRepo, (_e, path: string) => openRepoAtPath(path))
  ipcMain.handle(IPC.trustRepo, (_e, path: string) => trustRepo(path))

  ipcMain.handle(IPC.recentRepos, () => getRecentRepos())
  ipcMain.handle(IPC.removeRecent, (_e, path: string) => removeRecentRepo(path))
  ipcMain.handle(IPC.remoteUrl, (_e, repoPath: string) => getRemoteWebUrl(repoPath))
  ipcMain.handle(IPC.revealRepo, async (_e, repoPath: string) => {
    // openPath returns '' on success, an error string otherwise.
    const err = await shell.openPath(repoPath)
    return err === ''
  })
  ipcMain.handle(IPC.openTerminal, (_e, repoPath: string) => openTerminal(repoPath))

  // The snapshot is returned as a single JSON string: on a 90k-change repo the
  // object graph would otherwise be deep-copied twice (IPC structured clone,
  // then the contextBridge world boundary) — seconds of main-thread work.
  // Strings cross both boundaries in one cheap copy; the renderer parses.
  ipcMain.handle(IPC.snapshot, async (_e, repoPath: string) =>
    JSON.stringify(await getRepoSnapshot(repoPath))
  )
  ipcMain.handle(IPC.branches, (_e, repoPath: string) => getBranches(repoPath))
  ipcMain.handle(IPC.checkout, async (_e, repoPath: string, branch: string) => {
    // Checkout mutates HEAD/index/worktree → serialized on the write queue.
    await gitWrite.checkoutBranch(repoPath, branch, opProgressTo(repoPath, 'checkout'))
    return getBranches(repoPath)
  })
  ipcMain.handle(IPC.log, (_e, repoPath: string, options?: LogOptions) => getLog(repoPath, options))
  ipcMain.handle(IPC.commitFiles, (_e, repoPath: string, hash: string) =>
    getCommitFiles(repoPath, hash)
  )
  ipcMain.handle(IPC.workingDiff, (_e, repoPath: string, file: ChangedFile, area?: DiffArea) =>
    getWorkingDiff(repoPath, file, area)
  )
  ipcMain.handle(IPC.commitDiff, (_e, repoPath: string, hash: string, file: ChangedFile) =>
    getCommitDiff(repoPath, hash, file)
  )

  // ── Staging & commits ──
  ipcMain.handle(
    IPC.discardFiles,
    async (_e, repoPath: string, files: DiscardItem[], untrackedPaths: string[]) => {
      const { trashPaths, resetPaths, checkoutPaths } = gitWrite.planDiscard(files, untrackedPaths)
      // Big discards take real time (one trash call per file, then the git
      // steps) — report determinate progress so the dialog can show a bar.
      const progress = opProgressTo(repoPath, 'discard')
      let lastPercent = -1
      for (let i = 0; i < trashPaths.length; i++) {
        await shell.trashItem(join(repoPath, trashPaths[i])).catch(() => {})
        const percent = Math.round(((i + 1) / trashPaths.length) * 100)
        if (percent !== lastPercent) {
          lastPercent = percent
          progress('Moving to trash', percent)
        }
      }
      await gitWrite.discardFiles(repoPath, resetPaths, checkoutPaths, progress)
    }
  )
  ipcMain.handle(IPC.ignorePatterns, (_e, repoPath: string, patterns: string[]) =>
    gitWrite.ignorePatterns(repoPath, patterns)
  )
  ipcMain.handle(
    IPC.applyPatch,
    (_e, repoPath: string, patch: string, opts: { cached?: boolean; reverse?: boolean }) =>
      gitWrite.applyPatch(repoPath, patch, opts)
  )
  ipcMain.handle(IPC.commit, (_e, repoPath: string, message: string, sel: CommitSelection) =>
    gitWrite.commitSelection(repoPath, message, sel)
  )
  ipcMain.handle(IPC.lastCommitMessage, (_e, repoPath: string) =>
    gitWrite.lastCommitMessage(repoPath)
  )

  // ── Sync ──
  ipcMain.handle(IPC.fetch, (_e, repoPath: string, remote?: string) =>
    gitSync.fetch(repoPath, remote, opProgressTo(repoPath, 'fetch'))
  )
  ipcMain.handle(IPC.pull, (_e, repoPath: string, opts?: { rebase?: boolean }) =>
    gitSync.pull(repoPath, opts, opProgressTo(repoPath, 'pull'))
  )
  ipcMain.handle(
    IPC.push,
    (
      _e,
      repoPath: string,
      opts?: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean }
    ) => gitSync.push(repoPath, opts, opProgressTo(repoPath, 'push'))
  )

  // ── Branches ──
  ipcMain.handle(
    IPC.createBranch,
    (_e, repoPath: string, name: string, opts?: { from?: string; checkout?: boolean }) =>
      gitWrite.createBranch(repoPath, name, opts)
  )
  ipcMain.handle(
    IPC.deleteBranch,
    (_e, repoPath: string, name: string, opts?: { force?: boolean }) =>
      gitWrite.deleteBranch(repoPath, name, opts)
  )
  ipcMain.handle(IPC.renameBranch, (_e, repoPath: string, from: string, to: string) =>
    gitWrite.renameBranch(repoPath, from, to)
  )
  ipcMain.handle(IPC.checkoutDetached, (_e, repoPath: string, hash: string) =>
    gitWrite.checkoutDetached(repoPath, hash)
  )

  // ── Merge / rebase / history surgery ──
  ipcMain.handle(IPC.merge, (_e, repoPath: string, branch: string) =>
    gitWrite.merge(repoPath, branch)
  )
  ipcMain.handle(IPC.rebase, (_e, repoPath: string, onto: string) =>
    gitWrite.rebase(repoPath, onto)
  )
  ipcMain.handle(
    IPC.rebaseInteractive,
    (_e, repoPath: string, base: string, items: RebaseTodoItem[]) =>
      rebaseInteractive(repoPath, base, items)
  )
  ipcMain.handle(IPC.cherryPick, (_e, repoPath: string, hash: string) =>
    gitWrite.cherryPick(repoPath, hash)
  )
  ipcMain.handle(IPC.revertCommit, (_e, repoPath: string, hash: string) =>
    gitWrite.revertCommit(repoPath, hash)
  )
  ipcMain.handle(IPC.reset, (_e, repoPath: string, hash: string, mode: ResetMode) =>
    gitWrite.reset(repoPath, hash, mode)
  )
  ipcMain.handle(IPC.continueOp, (_e, repoPath: string, op: RepoOpKind) =>
    gitWrite.continueOp(repoPath, op)
  )
  ipcMain.handle(IPC.abortOp, (_e, repoPath: string, op: RepoOpKind) =>
    gitWrite.abortOp(repoPath, op)
  )
  ipcMain.handle(IPC.skipRebaseCommit, (_e, repoPath: string) =>
    gitWrite.skipRebaseCommit(repoPath)
  )
  ipcMain.handle(
    IPC.resolveConflict,
    (_e, repoPath: string, path: string, side: 'ours' | 'theirs') =>
      gitWrite.resolveConflict(repoPath, path, side)
  )
  ipcMain.handle(IPC.markResolved, (_e, repoPath: string, path: string) =>
    gitWrite.markResolved(repoPath, path)
  )
  ipcMain.handle(IPC.openFileInEditor, (_e, repoPath: string, path: string) =>
    shell.openPath(join(repoPath, path)).then(() => undefined)
  )

  // ── Stash ──
  ipcMain.handle(IPC.stashList, (_e, repoPath: string) => gitWrite.listStashes(repoPath))
  ipcMain.handle(IPC.stashFiles, async (_e, repoPath: string, sha: string) => {
    // A stash's tracked changes diff against its first parent; untracked
    // files live in a third parent commit (created by `stash push -u`) and
    // would otherwise be invisible in a review.
    const tracked = await getCommitFiles(repoPath, sha)
    let untracked: ChangedFile[] = []
    try {
      untracked = (await getCommitFiles(repoPath, `${sha}^3`)).map((f) => ({
        ...f,
        status: 'untracked' as const
      }))
    } catch {
      /* no untracked parent */
    }
    return [...tracked, ...untracked].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    )
  })
  ipcMain.handle(
    IPC.stashSave,
    (_e, repoPath: string, opts?: { message?: string; includeUntracked?: boolean }) =>
      gitWrite.stashSave(repoPath, opts)
  )
  ipcMain.handle(IPC.stashApply, (_e, repoPath: string, index: number, pop: boolean) =>
    gitWrite.stashApply(repoPath, index, pop)
  )
  ipcMain.handle(IPC.stashDrop, (_e, repoPath: string, index: number) =>
    gitWrite.stashDrop(repoPath, index)
  )

  // ── Tags ──
  ipcMain.handle(
    IPC.createTag,
    (
      _e,
      repoPath: string,
      name: string,
      opts?: { hash?: string; message?: string; push?: boolean }
    ) =>
      gitWrite.createTag(repoPath, name, opts)
  )
  ipcMain.handle(IPC.deleteTag, (_e, repoPath: string, name: string) =>
    gitWrite.deleteTag(repoPath, name)
  )

  // ── Worktrees & submodules ──
  ipcMain.handle(IPC.worktreeList, (_e, repoPath: string) => gitWrite.listWorktrees(repoPath))
  ipcMain.handle(
    IPC.worktreeAdd,
    (_e, repoPath: string, path: string, opts?: { branch?: string; newBranch?: string }) =>
      gitWrite.addWorktree(repoPath, path, opts)
  )
  ipcMain.handle(
    IPC.worktreeRemove,
    (_e, repoPath: string, path: string, opts?: { force?: boolean }) =>
      gitWrite.removeWorktree(repoPath, path, opts)
  )
  ipcMain.handle(IPC.submoduleList, (_e, repoPath: string) => gitWrite.listSubmodules(repoPath))
  ipcMain.handle(IPC.submoduleUpdate, (_e, repoPath: string) => gitWrite.updateSubmodules(repoPath))
  ipcMain.handle(IPC.optimizeRepo, (_e, repoPath: string) => gitWrite.optimizeRepo(repoPath))
  ipcMain.handle(IPC.selectionSize, async (_e, repoPath: string, paths: string[]) => {
    // Working-tree byte sizes of the included files — a fast, honest proxy
    // for "how big is this commit" (these are the blobs about to be written).
    const sizes = await Promise.all(
      paths.map((p) =>
        stat(join(repoPath, p)).then(
          (s) => (s.isFile() ? s.size : 0),
          () => 0
        )
      )
    )
    return sizes.reduce((a, b) => a + b, 0)
  })

  // ── Clone ──
  ipcMain.handle(IPC.cloneRepo, (_e, url: string, parentDir: string) =>
    gitSync.clone(url, parentDir, (phase, percent) => {
      getWindow()?.webContents.send(IPC.cloneProgress, { phase, percent, done: false })
    })
  )
  ipcMain.handle(IPC.pickDirectory, async (_e, title?: string) => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: title ?? 'Choose Folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose'
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.checkGit, (_e, force?: boolean) => checkGit(!!force))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.clipboardWrite, (_e, text: string) => clipboard.writeText(text))

  // Window controls for the custom title bar (Windows/Linux; no-ops elsewhere).
  ipcMain.handle(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.handle(IPC.windowMaximizeToggle, () => {
    const window = getWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.handle(IPC.windowClose, () => getWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  // Custom always-visible menu bar (Windows/Linux): the renderer draws the
  // top-level labels and asks us to pop the corresponding native submenu, so all
  // the existing menu actions/roles work without being reimplemented in the UI.
  ipcMain.handle(IPC.menuLabels, () => {
    const menu = Menu.getApplicationMenu()
    return menu ? menu.items.filter((i) => i.submenu).map((i) => i.label) : []
  })
  ipcMain.handle(IPC.menuPopup, (_e, label: string, x: number, y: number) => {
    const item = Menu.getApplicationMenu()?.items.find((i) => i.label === label)
    const window = getWindow()
    if (item?.submenu && window) {
      item.submenu.popup({ window, x: Math.round(x), y: Math.round(y) })
    }
  })

  ipcMain.handle(IPC.appInfo, () => appInfo())
  ipcMain.handle(IPC.checkForUpdates, (_e, manual: boolean) => checkForUpdates(getWindow, manual))
  ipcMain.handle(IPC.installUpdate, () => quitAndInstall())
}
