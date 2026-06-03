import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The main bundle is emitted as ESM (package.json "type": "module"), where
// __dirname is not defined — reconstruct it from the module URL.
const moduleDir = dirname(fileURLToPath(import.meta.url))

// In a packaged build the app's icon comes from the .app/.exe bundle. While
// developing we run inside the generic Electron binary, so point the dock /
// window icon at build/icon.png (sits two levels up from out/main) ourselves.
const devIconPath = join(moduleDir, '../../build/icon.png')

import { IPC } from '@shared/ipc'
import type { AppInfo, ChangedFile, LogOptions } from '@shared/types'
import {
  checkout,
  getBranches,
  getCommitDiff,
  getCommitFiles,
  getLog,
  getQuickSummary,
  getStatus,
  getWorkingDiff,
  resolveRepoRoot
} from './git'
import { getRecentRepos, rememberRepo, removeRecentRepo } from './store'
import { RepoWatcher } from './watcher'
import { checkForUpdates, initAutoUpdater, quitAndInstall } from './updater'

const isDev = !app.isPackaged
const REPO_URL = 'https://github.com/danipen/gitgrove'
let mainWindow: BrowserWindow | null = null

function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    dev: isDev,
    repoUrl: REPO_URL
  }
}

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
    // Window icon is used on Windows/Linux (ignored on macOS); only needed in
    // dev — packaged builds carry the icon in the executable.
    ...(isDev ? { icon: devIconPath } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(moduleDir, '../preload/index.js'),
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
    mainWindow.loadFile(join(moduleDir, '../renderer/index.html'))
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
              {
                label: `About ${app.name}`,
                click: () => mainWindow?.webContents.send(IPC.menuShowAbout)
              },
              {
                label: 'Check for Updates…',
                click: () => checkForUpdates(() => mainWindow, true)
              },
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
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'GitGrove on GitHub',
          click: () => shell.openExternal(REPO_URL)
        },
        {
          label: 'Report an Issue…',
          click: () => shell.openExternal(`${REPO_URL}/issues/new`)
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              {
                label: 'Check for Updates…',
                click: () => checkForUpdates(() => mainWindow, true)
              },
              {
                label: `About ${app.name}`,
                click: () => mainWindow?.webContents.send(IPC.menuShowAbout)
              }
            ])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Open a folder, resolve it to a repo root, persist as recent, watch it.
 * Returns a cheap summary (current branch only) so the renderer can switch
 * instantly; branches and status are fetched separately by the renderer.
 */
async function openRepoAtPath(rawPath: string) {
  const root = await resolveRepoRoot(rawPath)
  if (!root) {
    throw new Error('The selected folder is not a git repository.')
  }
  const summary = await getQuickSummary(root)
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

  ipcMain.handle(IPC.appInfo, () => appInfo())
  ipcMain.handle(IPC.checkForUpdates, (_e, manual: boolean) =>
    checkForUpdates(() => mainWindow, manual)
  )
  ipcMain.handle(IPC.installUpdate, () => quitAndInstall())
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: 'Copyright © 2026 GitGrove',
    website: REPO_URL
  })

  // macOS ignores the BrowserWindow icon and shows the bundle icon in the dock;
  // in dev that's the generic Electron icon, so override it explicitly.
  if (isDev && process.platform === 'darwin' && app.dock) {
    const img = nativeImage.createFromPath(devIconPath)
    if (!img.isEmpty()) app.dock.setIcon(img)
  }

  registerIpc()
  buildMenu()
  createWindow()
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.unwatchAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => watcher.unwatchAll())
