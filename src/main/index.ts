import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  shell
} from 'electron'

// The main bundle is emitted as ESM (package.json "type": "module"), where
// __dirname is not defined — reconstruct it from the module URL.
const moduleDir = dirname(fileURLToPath(import.meta.url))

// In a packaged build the app's icon comes from the .app/.exe bundle. While
// developing we run inside the generic Electron binary, so point the dock /
// window icon at build/icon.png (sits two levels up from out/main) ourselves.
const devIconPath = join(moduleDir, '../../build/icon.png')

import { IPC, type MenuCommand } from '@shared/ipc'
import type {
  AppInfo,
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
import {
  addSafeDirectory,
  DubiousOwnershipError,
  getBranches,
  getCommitDiff,
  getCommitFiles,
  getLog,
  getQuickSummary,
  getRemoteWebUrl,
  getWorkingDiff,
  resolveRepoRoot
} from './git'
import { getRepoSnapshot } from './git-status'
import * as gitWrite from './git-write'
import { gitVersion, locateGit, resetGitLocation } from './git-bin'
import { getRecentRepos, rememberRepo, removeRecentRepo } from './store'
import { checkForUpdates, initAutoUpdater, quitAndInstall } from './updater'
import { RepoWatcher } from './watcher'

const isDev = !app.isPackaged
const REPO_URL = 'https://github.com/danipen/gitgrove'

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
      buildMenu()
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

function sendMenuCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IPC.menuCommand, command)
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
        {
          label: 'Clone Repository…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuCommand('clone')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      // Mirrors the repo switcher's right-click actions for the repo currently
      // open in the renderer; disabled until one is. Also surfaces these in the
      // Windows/Linux custom menu bar, which reads this same application menu.
      label: 'Repository',
      submenu: [
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+Shift+F',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('fetch')
        },
        {
          label: 'Pull',
          accelerator: 'CmdOrCtrl+Shift+P',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('pull')
        },
        {
          label: 'Push',
          accelerator: 'CmdOrCtrl+P',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('push')
        },
        { type: 'separator' },
        {
          label: 'New Branch…',
          accelerator: 'CmdOrCtrl+Shift+N',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('new-branch')
        },
        {
          label: 'Stash All Changes…',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('stash')
        },
        { type: 'separator' },
        {
          label: 'Speed Up Large Repository',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('optimize')
        },
        { type: 'separator' },
        {
          label: 'Worktrees…',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('worktrees')
        },
        {
          label: 'Submodules…',
          enabled: !!currentRepoPath,
          click: () => sendMenuCommand('submodules')
        },
        { type: 'separator' },
        {
          label: isMac
            ? 'Reveal in Finder'
            : process.platform === 'win32'
              ? 'Show in Explorer'
              : 'Open Folder',
          enabled: !!currentRepoPath,
          click: () => currentRepoPath && shell.openPath(currentRepoPath)
        },
        {
          label: 'Open in Terminal',
          enabled: !!currentRepoPath,
          click: () => currentRepoPath && openTerminal(currentRepoPath)
        },
        { type: 'separator' },
        {
          label: 'Copy Repository Path',
          enabled: !!currentRepoPath,
          click: () => currentRepoPath && clipboard.writeText(currentRepoPath)
        },
        {
          label: 'View on Remote',
          enabled: !!currentRepoPath,
          click: async () => {
            if (!currentRepoPath) return
            const url = await getRemoteWebUrl(currentRepoPath)
            if (url) shell.openExternal(url)
          }
        }
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
  buildMenu()
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

/**
 * Open a terminal rooted at `cwd`. There's no cross-platform Electron API for
 * this, so launch the platform's stock terminal: Terminal.app on macOS, a new
 * `cmd` window on Windows, and the freedesktop-preferred emulator (falling back
 * through common ones) on Linux. Detaches the child so it outlives GitGrove and
 * returns whether a terminal was launched.
 */
function openTerminal(cwd: string): boolean {
  const launch = (cmd: string, args: string[]): boolean => {
    try {
      const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return true
    } catch {
      return false
    }
  }

  if (process.platform === 'darwin') return launch('open', ['-a', 'Terminal', cwd])
  if (process.platform === 'win32')
    return launch('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${cwd}"`])
  // Linux: spawn reports a missing binary only asynchronously, so probe PATH
  // first and launch the user's configured emulator, then well-known ones.
  const onPath = (cmd: string) =>
    (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, cmd)))
  const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].find(onPath)
  return term ? launch(term, []) : false
}

/**
 * Progress forwarder for a long-running op: pushes phase + percent to the
 * renderer so the matching button can fill determinately while git works.
 */
function opProgressTo(repoPath: string, kind: ProgressOpKind) {
  return (phase: string, percent: number): void => {
    const progress: OpProgress = { repoPath, kind, phase, percent }
    mainWindow?.webContents.send(IPC.opProgress, progress)
  }
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
      // Discard means: every chosen path ends up exactly as in HEAD.
      // Files HEAD doesn't have — untracked, staged-new, rename targets — move
      // to the OS trash so a mis-click is recoverable; everything else is
      // reset (unstaged) and restored from HEAD. A rename's R entry lives in
      // the index, so without the reset a discarded rename would survive.
      const trashPaths = [...untrackedPaths]
      const resetPaths: string[] = []
      const checkoutPaths: string[] = []
      for (const f of files) {
        if (f.oldPath) {
          // Rename/copy: forget both sides, restore the old path; the new
          // path is trashed below.
          trashPaths.push(f.path)
          resetPaths.push(f.path, f.oldPath)
          checkoutPaths.push(f.oldPath)
        } else if (f.status === 'added') {
          // Staged new file: nothing in HEAD to restore.
          trashPaths.push(f.path)
          resetPaths.push(f.path)
        } else {
          resetPaths.push(f.path)
          checkoutPaths.push(f.path)
        }
      }
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
    gitWrite.fetch(repoPath, remote, opProgressTo(repoPath, 'fetch'))
  )
  ipcMain.handle(IPC.pull, (_e, repoPath: string, opts?: { rebase?: boolean }) =>
    gitWrite.pull(repoPath, opts, opProgressTo(repoPath, 'pull'))
  )
  ipcMain.handle(
    IPC.push,
    (
      _e,
      repoPath: string,
      opts?: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean }
    ) => gitWrite.push(repoPath, opts, opProgressTo(repoPath, 'push'))
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
      gitWrite.rebaseInteractive(repoPath, base, items)
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
    gitWrite.clone(url, parentDir, (phase, percent) => {
      mainWindow?.webContents.send(IPC.cloneProgress, { phase, percent, done: false })
    })
  )
  ipcMain.handle(IPC.pickDirectory, async (_e, title?: string) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
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
  ipcMain.handle(IPC.windowMinimize, () => mainWindow?.minimize())
  ipcMain.handle(IPC.windowMaximizeToggle, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle(IPC.windowClose, () => mainWindow?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow?.isMaximized() ?? false)

  // Custom always-visible menu bar (Windows/Linux): the renderer draws the
  // top-level labels and asks us to pop the corresponding native submenu, so all
  // the existing menu actions/roles work without being reimplemented in the UI.
  ipcMain.handle(IPC.menuLabels, () => {
    const menu = Menu.getApplicationMenu()
    return menu ? menu.items.filter((i) => i.submenu).map((i) => i.label) : []
  })
  ipcMain.handle(IPC.menuPopup, (_e, label: string, x: number, y: number) => {
    const item = Menu.getApplicationMenu()?.items.find((i) => i.label === label)
    if (item?.submenu && mainWindow) {
      item.submenu.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) })
    }
  })

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
