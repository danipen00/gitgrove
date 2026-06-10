import { type GitGroveApi, IPC, type MenuCommand } from '@shared/ipc'
import type { ChangedFile, CloneProgress, DiffArea, LogOptions, UpdateStatus } from '@shared/types'
import { contextBridge, ipcRenderer } from 'electron'

const api: GitGroveApi = {
  platform: process.platform,
  pickRepo: () => ipcRenderer.invoke(IPC.pickRepo),
  openRepo: (path) => ipcRenderer.invoke(IPC.openRepo, path),
  trustRepo: (path) => ipcRenderer.invoke(IPC.trustRepo, path),
  recentRepos: () => ipcRenderer.invoke(IPC.recentRepos),
  removeRecent: (path) => ipcRenderer.invoke(IPC.removeRecent, path),
  remoteUrl: (repoPath) => ipcRenderer.invoke(IPC.remoteUrl, repoPath),
  revealRepo: (repoPath) => ipcRenderer.invoke(IPC.revealRepo, repoPath),
  openTerminal: (repoPath) => ipcRenderer.invoke(IPC.openTerminal, repoPath),
  snapshot: (repoPath) => ipcRenderer.invoke(IPC.snapshot, repoPath),
  branches: (repoPath) => ipcRenderer.invoke(IPC.branches, repoPath),
  checkout: (repoPath, branch) => ipcRenderer.invoke(IPC.checkout, repoPath, branch),
  log: (repoPath, options?: LogOptions) => ipcRenderer.invoke(IPC.log, repoPath, options),
  commitFiles: (repoPath, hash) => ipcRenderer.invoke(IPC.commitFiles, repoPath, hash),
  workingDiff: (repoPath, file: ChangedFile, area?: DiffArea) =>
    ipcRenderer.invoke(IPC.workingDiff, repoPath, file, area),
  commitDiff: (repoPath, hash, file: ChangedFile) =>
    ipcRenderer.invoke(IPC.commitDiff, repoPath, hash, file),
  discardFiles: (repoPath, files, untrackedPaths) =>
    ipcRenderer.invoke(IPC.discardFiles, repoPath, files, untrackedPaths),
  applyPatch: (repoPath, patch, opts) => ipcRenderer.invoke(IPC.applyPatch, repoPath, patch, opts),
  commit: (repoPath, message, selection) =>
    ipcRenderer.invoke(IPC.commit, repoPath, message, selection),
  lastCommitMessage: (repoPath) => ipcRenderer.invoke(IPC.lastCommitMessage, repoPath),
  fetch: (repoPath, remote) => ipcRenderer.invoke(IPC.fetch, repoPath, remote),
  pull: (repoPath, opts) => ipcRenderer.invoke(IPC.pull, repoPath, opts),
  push: (repoPath, opts) => ipcRenderer.invoke(IPC.push, repoPath, opts),
  createBranch: (repoPath, name, opts) =>
    ipcRenderer.invoke(IPC.createBranch, repoPath, name, opts),
  deleteBranch: (repoPath, name, opts) =>
    ipcRenderer.invoke(IPC.deleteBranch, repoPath, name, opts),
  renameBranch: (repoPath, from, to) => ipcRenderer.invoke(IPC.renameBranch, repoPath, from, to),
  checkoutDetached: (repoPath, hash) => ipcRenderer.invoke(IPC.checkoutDetached, repoPath, hash),
  merge: (repoPath, branch) => ipcRenderer.invoke(IPC.merge, repoPath, branch),
  rebase: (repoPath, onto) => ipcRenderer.invoke(IPC.rebase, repoPath, onto),
  rebaseInteractive: (repoPath, base, items) =>
    ipcRenderer.invoke(IPC.rebaseInteractive, repoPath, base, items),
  cherryPick: (repoPath, hash) => ipcRenderer.invoke(IPC.cherryPick, repoPath, hash),
  revertCommit: (repoPath, hash) => ipcRenderer.invoke(IPC.revertCommit, repoPath, hash),
  reset: (repoPath, hash, mode) => ipcRenderer.invoke(IPC.reset, repoPath, hash, mode),
  continueOp: (repoPath, op) => ipcRenderer.invoke(IPC.continueOp, repoPath, op),
  abortOp: (repoPath, op) => ipcRenderer.invoke(IPC.abortOp, repoPath, op),
  skipRebaseCommit: (repoPath) => ipcRenderer.invoke(IPC.skipRebaseCommit, repoPath),
  resolveConflict: (repoPath, path, side) =>
    ipcRenderer.invoke(IPC.resolveConflict, repoPath, path, side),
  markResolved: (repoPath, path) => ipcRenderer.invoke(IPC.markResolved, repoPath, path),
  openFileInEditor: (repoPath, path) => ipcRenderer.invoke(IPC.openFileInEditor, repoPath, path),
  stashList: (repoPath) => ipcRenderer.invoke(IPC.stashList, repoPath),
  stashFiles: (repoPath, sha) => ipcRenderer.invoke(IPC.stashFiles, repoPath, sha),
  stashSave: (repoPath, opts) => ipcRenderer.invoke(IPC.stashSave, repoPath, opts),
  stashApply: (repoPath, index, pop) => ipcRenderer.invoke(IPC.stashApply, repoPath, index, pop),
  stashDrop: (repoPath, index) => ipcRenderer.invoke(IPC.stashDrop, repoPath, index),
  createTag: (repoPath, name, opts) => ipcRenderer.invoke(IPC.createTag, repoPath, name, opts),
  deleteTag: (repoPath, name) => ipcRenderer.invoke(IPC.deleteTag, repoPath, name),
  worktreeList: (repoPath) => ipcRenderer.invoke(IPC.worktreeList, repoPath),
  worktreeAdd: (repoPath, path, opts) => ipcRenderer.invoke(IPC.worktreeAdd, repoPath, path, opts),
  worktreeRemove: (repoPath, path, opts) =>
    ipcRenderer.invoke(IPC.worktreeRemove, repoPath, path, opts),
  submoduleList: (repoPath) => ipcRenderer.invoke(IPC.submoduleList, repoPath),
  submoduleUpdate: (repoPath) => ipcRenderer.invoke(IPC.submoduleUpdate, repoPath),
  optimizeRepo: (repoPath) => ipcRenderer.invoke(IPC.optimizeRepo, repoPath),
  selectionSize: (repoPath, paths) => ipcRenderer.invoke(IPC.selectionSize, repoPath, paths),
  cloneRepo: (url, parentDir) => ipcRenderer.invoke(IPC.cloneRepo, url, parentDir),
  pickDirectory: (title) => ipcRenderer.invoke(IPC.pickDirectory, title),
  checkGit: (force) => ipcRenderer.invoke(IPC.checkGit, force),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  clipboardWrite: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  checkForUpdates: (manual) => ipcRenderer.invoke(IPC.checkForUpdates, manual),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  windowMaximizeToggle: () => ipcRenderer.invoke(IPC.windowMaximizeToggle),
  windowClose: () => ipcRenderer.invoke(IPC.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
  menuLabels: () => ipcRenderer.invoke(IPC.menuLabels),
  menuPopup: (label, x, y) => ipcRenderer.invoke(IPC.menuPopup, label, x, y),
  onWindowMaximized: (handler) => {
    const listener = (_e: unknown, maximized: boolean) => handler(maximized)
    ipcRenderer.on(IPC.windowMaximized, listener)
    return () => ipcRenderer.removeListener(IPC.windowMaximized, listener)
  },
  onRepoChanged: (handler) => {
    const listener = (_e: unknown, repoPath: string) => handler(repoPath)
    ipcRenderer.on(IPC.repoChanged, listener)
    return () => ipcRenderer.removeListener(IPC.repoChanged, listener)
  },
  onMenuOpenRepo: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(IPC.menuOpenRepo, listener)
    return () => ipcRenderer.removeListener(IPC.menuOpenRepo, listener)
  },
  onShowAbout: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(IPC.menuShowAbout, listener)
    return () => ipcRenderer.removeListener(IPC.menuShowAbout, listener)
  },
  onMenuCommand: (handler) => {
    const listener = (_e: unknown, command: MenuCommand) => handler(command)
    ipcRenderer.on(IPC.menuCommand, listener)
    return () => ipcRenderer.removeListener(IPC.menuCommand, listener)
  },
  onCloneProgress: (handler) => {
    const listener = (_e: unknown, progress: CloneProgress) => handler(progress)
    ipcRenderer.on(IPC.cloneProgress, listener)
    return () => ipcRenderer.removeListener(IPC.cloneProgress, listener)
  },
  onUpdateStatus: (handler) => {
    const listener = (_e: unknown, status: UpdateStatus) => handler(status)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  }
}

contextBridge.exposeInMainWorld('gitgrove', api)
