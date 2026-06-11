// Persists the main window's geometry in userData/window-state.json and keeps
// it current for the window's whole life. The reconciliation rules (monitor
// gone, window oversized, title bar off-screen) are pure and live in
// window-state.ts; this file is only the Electron and file-system glue.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow, screen } from 'electron'
import { sanitizeWindowState, type WindowState } from './window-state'

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * Read the saved state and reconcile it against the displays attached right
 * now. Missing or corrupt files simply yield the defaults — restoring
 * geometry is a convenience, never a reason to fail startup.
 */
export function loadWindowState(): WindowState {
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    // First launch, or an unreadable/corrupt file — sanitize handles null.
  }
  const workAreas = screen.getAllDisplays().map((display) => display.workArea)
  return sanitizeWindowState(raw, workAreas)
}

// The write on 'close' is the authoritative one; the debounced writes during
// move/resize are belt-and-braces so a crash or force-quit still restores the
// latest geometry instead of a stale session's.
const SAVE_DEBOUNCE_MS = 500

/** Watch a window and persist its geometry as it changes and when it closes. */
export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed()) return
    // getNormalBounds() reports the *restored* bounds even while maximized or
    // full-screen, so unmaximizing after a relaunch lands the window where the
    // user last placed it — not frozen at the maximized size.
    const state = {
      ...win.getNormalBounds(),
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    }
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8')
    } catch {
      // Non-fatal: worst case the next launch opens at the default size.
    }
  }

  let pending: ReturnType<typeof setTimeout> | undefined
  const queueSave = (): void => {
    clearTimeout(pending)
    pending = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  // 'move' and 'resize' fire continuously during a drag on all three
  // platforms (the one-shot 'moved'/'resized' variants are macOS/Windows
  // only), hence the debounce rather than saving on every event.
  win.on('move', queueSave)
  win.on('resize', queueSave)
  win.on('maximize', queueSave)
  win.on('unmaximize', queueSave)
  win.on('close', () => {
    clearTimeout(pending)
    save()
  })
}
