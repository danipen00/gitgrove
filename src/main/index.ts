import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage, shell } from 'electron'

// The main bundle is emitted as ESM (package.json "type": "module"), where
// __dirname is not defined — reconstruct it from the module URL.
const moduleDir = dirname(fileURLToPath(import.meta.url))

// In a packaged build the app's icon comes from the .app/.exe bundle. While
// developing we run inside the generic Electron binary, so point the dock /
// window icon at build/icon.png (sits two levels up from out/main) ourselves.
const devIconPath = join(moduleDir, '../../build/icon.png')

import { IPC } from '@shared/ipc'
import type { GitAvailability, RepoOpenResult } from '@shared/types'
import { REPO_URL } from './app-info'
import { gitVersion, locateGit, resetGitLocation } from './git/bin'
import {
  addSafeDirectory,
  DubiousOwnershipError,
  getQuickSummary,
  resolveRepoRoot
} from './git/read'
import { registerIpc } from './ipc'
import { buildMenu, type MenuContext } from './menu'
import { rememberRepo } from './store'
import { initAutoUpdater } from './updater'
import { RepoWatcher } from './watcher'

const isDev = !app.isPackaged

// Chromium's OSCrypt encrypts its own on-disk data (cookies, storage) with a
// key it keeps in the OS secret store — the macOS keychain entry "GitGrove
// Safe Storage". Reaching that entry pops a "GitGrove wants to use your
// confidential information" password dialog, because our ad-hoc-signed builds
// get a fresh code signature each version, so the keychain ACL never matches
// the new signature and the grant can't persist. GitGrove keeps no secrets
// (recents are plaintext JSON), so opt out of the OS store entirely and let
// Chromium use an in-memory key instead. Must run before app ready.
//
// Two flags are needed because they cover different platforms:
//   - `password-store=basic` selects Chromium's basic (in-memory) store on
//     *Linux* (libsecret/kwallet otherwise). It is a NO-OP on macOS — OSCrypt
//     there always uses the Keychain regardless of this switch, which is why
//     the dialog kept appearing despite it.
//   - `use-mock-keychain` is the macOS lever: it makes OSCrypt use a mock,
//     in-process keychain and never touch the real one (verified: with it set,
//     the "GitGrove Safe Storage" entry is no longer created or read).
app.commandLine.appendSwitch('password-store', 'basic')
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('use-mock-keychain')
}

// Opt-in CDP debugging: when GITGROVE_DEBUG_PORT is set (e.g. `bun dev:debug`),
// expose Chromium's remote-debugging endpoint so tools like the Playwright CLI
// can attach to the renderer (`playwright-cli attach --cdp http://localhost:PORT`).
// Never set in normal or packaged runs, so the port stays closed by default.
if (process.env.GITGROVE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.GITGROVE_DEBUG_PORT)
}

let mainWindow: BrowserWindow | null = null

// Path of the repo currently open in the renderer, mirrored here so the
// application menu's repo actions (Reveal in Finder, Open in Terminal, …) know
// what to act on. Null until the first repo opens; the Repository menu items
// are disabled while it is.
let currentRepoPath: string | null = null

const menuContext: MenuContext = {
  getWindow: () => mainWindow,
  getRepoPath: () => currentRepoPath
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
    // macOS keeps its inset traffic lights. On Windows/Linux we hide the native
    // title bar and menu bar so the app's toolbar acts as the title bar, with
    // custom window controls (see WindowControls) painted into it — Alt still
    // reveals the menu bar on demand.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(moduleDir, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Keep the renderer's custom window controls (Windows/Linux) in sync with the
  // real maximize state so the maximize/restore glyph matches the window.
  const emitMaximized = () =>
    mainWindow?.webContents.send(IPC.windowMaximized, mainWindow.isMaximized())
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // A renderer reload (Ctrl/Cmd+R) drops back to the welcome screen with no repo
  // open, but our mirrored currentRepoPath survives here in the main process.
  // Clear it on every page load so the Repository menu's actions don't keep
  // targeting the previously opened repo; openRepoAtPath re-sets it when the
  // user opens one again.
  mainWindow.webContents.on('did-start-loading', () => {
    if (currentRepoPath !== null) {
      currentRepoPath = null
      buildMenu(menuContext)
    }
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

/**
 * Open a folder, resolve it to a repo root, persist as recent, watch it.
 * Returns a cheap summary (current branch only) so the renderer can switch
 * instantly; branches and status are fetched separately by the renderer.
 */
async function openRepoAtPath(rawPath: string): Promise<RepoOpenResult> {
  // The setup screen normally prevents reaching here without git; locateGit is a
  // backstop that throws a clear GitNotFoundError if git really is missing.
  await locateGit()
  let root: string | null
  try {
    root = await resolveRepoRoot(rawPath)
  } catch (e) {
    // git won't open the repo until its ownership is trusted — let the renderer
    // prompt the user instead of failing as if it weren't a repo.
    if (e instanceof DubiousOwnershipError) return { ok: false, reason: 'untrusted', path: rawPath }
    throw e
  }
  if (!root) return { ok: false, reason: 'not-git', path: rawPath }
  const summary = await getQuickSummary(root)
  rememberRepo({ path: summary.path, name: summary.name })
  watcher.watch(root)
  // Point the application menu's repo actions at the now-open repo (and enable
  // them if this is the first one).
  currentRepoPath = summary.path
  buildMenu(menuContext)
  return { ok: true, summary }
}

/**
 * Trust a folder git flagged as untrusted, then open it. Re-probes to recover
 * git's exact recommended `safe.directory` value, persists it globally (so the
 * trust sticks across sessions and tools), and opens. If the folder is already
 * trusted by the time we get here, this just opens it.
 */
async function trustRepo(rawPath: string): Promise<RepoOpenResult> {
  try {
    await resolveRepoRoot(rawPath)
  } catch (e) {
    if (e instanceof DubiousOwnershipError) {
      await addSafeDirectory(e.safeValue)
    } else {
      throw e
    }
  }
  return openRepoAtPath(rawPath)
}

/**
 * Report whether a usable git is available. `force` re-probes (used by the
 * setup screen's "Re-check" after the user installs git) instead of reusing the
 * cached lookup.
 */
async function checkGit(force: boolean): Promise<GitAvailability> {
  if (force) resetGitLocation()
  try {
    const path = await locateGit()
    const version = await gitVersion()
    return { available: true, path, version, platform: process.platform }
  } catch {
    return { available: false, platform: process.platform }
  }
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

  registerIpc({ getWindow: () => mainWindow, openRepoAtPath, trustRepo, checkGit })
  buildMenu(menuContext)
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
