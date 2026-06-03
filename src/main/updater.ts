// Auto-update wiring built on electron-updater (GitHub Releases provider, see
// electron-builder.yml). The main process owns the autoUpdater instance and
// relays its lifecycle to the renderer as `UpdateStatus` pushes; the renderer
// only ever asks to "check" or "install".
//
// Behaviour:
//  - On launch we run one silent background check (errors stay quiet).
//  - The Help ▸ "Check for Updates…" menu item and the About dialog run a
//    *manual* check, which also surfaces the "you're up to date" result.
//  - Updates download automatically; when ready the renderer shows a banner
//    offering to restart. Quitting also installs a pending update.

import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'

import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

// electron-updater is CommonJS; under our ESM main bundle the instance lives on
// the default export.
const { autoUpdater } = electronUpdater

const version = app.getVersion()
let manualCheck = false
let initialized = false

/** Flatten electron-updater's string | {note}[] release notes to plain text. */
function notesToText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim() || undefined
  return (
    notes
      .map((n) => n.note ?? '')
      .join('\n\n')
      .replace(/<[^>]+>/g, '')
      .trim() || undefined
  )
}

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const push = (status: Omit<UpdateStatus, 'version' | 'manual'>) =>
    getWindow()?.webContents.send(IPC.updateStatus, {
      ...status,
      version,
      manual: manualCheck
    } satisfies UpdateStatus)

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    push({ state: 'available', newVersion: info.version, notes: notesToText(info.releaseNotes) })
  )
  autoUpdater.on('update-not-available', () => push({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    push({ state: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond })
  )
  autoUpdater.on('update-downloaded', (info) =>
    push({ state: 'downloaded', newVersion: info.version, notes: notesToText(info.releaseNotes) })
  )
  autoUpdater.on('error', (err) =>
    push({ state: 'error', error: err == null ? 'unknown error' : (err.message ?? String(err)) })
  )

  // One quiet check shortly after startup so we don't compete with first paint.
  setTimeout(() => void checkForUpdates(getWindow, false), 4000)
}

export async function checkForUpdates(
  getWindow: () => BrowserWindow | null,
  manual: boolean
): Promise<void> {
  manualCheck = manual

  // electron-updater throws ("update checking is disabled…") for unpackaged
  // builds. Tell the user plainly when they ask; stay silent on auto-checks.
  if (!app.isPackaged) {
    if (manual) {
      getWindow()?.webContents.send(IPC.updateStatus, {
        state: 'dev',
        version,
        manual: true
      } satisfies UpdateStatus)
    }
    return
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    getWindow()?.webContents.send(IPC.updateStatus, {
      state: 'error',
      version,
      manual,
      error: err instanceof Error ? err.message : String(err)
    } satisfies UpdateStatus)
  }
}

export function quitAndInstall(): void {
  // isSilent=false (show the installer on Windows), isForceRunAfter=true (relaunch).
  autoUpdater.quitAndInstall(false, true)
}
