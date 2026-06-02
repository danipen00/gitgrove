import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

import { IPC } from '@shared/ipc'
import type { ChangedFile, LogOptions } from '@shared/types'
import {
  checkout,
  getBranches,
  getCommitDiff,
  getCommitFiles,
  getLog,
  getStatus,
  getSummary,
  getWorkingDiff,
  resolveRepoRoot
} from './git'
import { getRecentRepos, rememberRepo, removeRecentRepo } from './store'
import { RepoWatcher } from './watcher'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

const watcher = new RepoWatcher((repoPath) => {
  mainWindow?.webContents.send(IPC.repoChanged, repoPath)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#0c0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send(IPC.menuOpenRepo)
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Open a folder, resolve it to a repo root, persist as recent, watch it. */
async function openRepoAtPath(rawPath: string) {
  const root = await resolveRepoRoot(rawPath)
  if (!root) {
    throw new Error('The selected folder is not a git repository.')
  }
  const summary = await getSummary(root)
  rememberRepo({ path: summary.path, name: summary.name })
  watcher.watch(root)
  return summary
}

function registerIpc(): void {
  ipcMain.handle(IPC.pickRepo, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Git Repository',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openRepoAtPath(result.filePaths[0])
  })

  ipcMain.handle(IPC.openRepo, (_e, path: string) => openRepoAtPath(path))

  ipcMain.handle(IPC.recentRepos, () => getRecentRepos())
  ipcMain.handle(IPC.removeRecent, (_e, path: string) => removeRecentRepo(path))

  ipcMain.handle(IPC.status, (_e, repoPath: string) => getStatus(repoPath))
  ipcMain.handle(IPC.branches, (_e, repoPath: string) => getBranches(repoPath))
  ipcMain.handle(IPC.checkout, (_e, repoPath: string, branch: string) => checkout(repoPath, branch))
  ipcMain.handle(IPC.log, (_e, repoPath: string, options?: LogOptions) => getLog(repoPath, options))
  ipcMain.handle(IPC.commitFiles, (_e, repoPath: string, hash: string) => getCommitFiles(repoPath, hash))
  ipcMain.handle(IPC.workingDiff, (_e, repoPath: string, file: ChangedFile) =>
    getWorkingDiff(repoPath, file)
  )
  ipcMain.handle(IPC.commitDiff, (_e, repoPath: string, hash: string, file: ChangedFile) =>
    getCommitDiff(repoPath, hash, file)
  )
}

app.whenReady().then(() => {
  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.unwatchAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => watcher.unwatchAll())
