import { type GitGroveApi, IPC } from '@shared/ipc'
import type { ChangedFile, LogOptions, UpdateStatus } from '@shared/types'
import { contextBridge, ipcRenderer } from 'electron'

const api: GitGroveApi = {
  platform: process.platform,
  pickRepo: () => ipcRenderer.invoke(IPC.pickRepo),
  openRepo: (path) => ipcRenderer.invoke(IPC.openRepo, path),
  trustRepo: (path) => ipcRenderer.invoke(IPC.trustRepo, path),
  recentRepos: () => ipcRenderer.invoke(IPC.recentRepos),
  removeRecent: (path) => ipcRenderer.invoke(IPC.removeRecent, path),
  status: (repoPath) => ipcRenderer.invoke(IPC.status, repoPath),
  branches: (repoPath) => ipcRenderer.invoke(IPC.branches, repoPath),
  checkout: (repoPath, branch) => ipcRenderer.invoke(IPC.checkout, repoPath, branch),
  log: (repoPath, options?: LogOptions) => ipcRenderer.invoke(IPC.log, repoPath, options),
  commitFiles: (repoPath, hash) => ipcRenderer.invoke(IPC.commitFiles, repoPath, hash),
  workingDiff: (repoPath, file: ChangedFile) => ipcRenderer.invoke(IPC.workingDiff, repoPath, file),
  commitDiff: (repoPath, hash, file: ChangedFile) =>
    ipcRenderer.invoke(IPC.commitDiff, repoPath, hash, file),
  checkGit: (force) => ipcRenderer.invoke(IPC.checkGit, force),
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
  onUpdateStatus: (handler) => {
    const listener = (_e: unknown, status: UpdateStatus) => handler(status)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  }
}

contextBridge.exposeInMainWorld('gitgrove', api)
