// Central registry of IPC channel names and the typed shape of the API the
// preload script exposes on `window.gitgrove`. Both the main process handlers
// and the renderer client import from here so the contract stays in one place.

import type {
  AppInfo,
  BranchInfo,
  ChangedFile,
  Commit,
  DiffPayload,
  LogOptions,
  RecentRepo,
  RepoSummary,
  UpdateStatus
} from './types'

export const IPC = {
  pickRepo: 'repo:pick',
  openRepo: 'repo:open',
  recentRepos: 'repo:recent',
  removeRecent: 'repo:recent:remove',
  status: 'repo:status',
  branches: 'repo:branches',
  checkout: 'repo:checkout',
  log: 'repo:log',
  commitFiles: 'repo:commit:files',
  workingDiff: 'repo:diff:working',
  commitDiff: 'repo:diff:commit',
  // app / updates
  appInfo: 'app:info',
  checkForUpdates: 'update:check',
  installUpdate: 'update:install',
  // custom window controls (Windows/Linux title bar)
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  // custom menu bar (Windows/Linux title bar)
  menuLabels: 'menu:labels',
  menuPopup: 'menu:popup',
  // main -> renderer pushes
  repoChanged: 'repo:changed',
  menuOpenRepo: 'menu:open-repo',
  menuShowAbout: 'menu:about',
  updateStatus: 'update:status',
  windowMaximized: 'window:maximized'
} as const

export interface GitGroveApi {
  /** Host platform, resolved synchronously at preload so the UI can branch on it. */
  platform: NodeJS.Platform
  /** Open the native folder picker; resolves null if cancelled or not a repo. */
  pickRepo(): Promise<RepoSummary | null>
  /** Open a known path as a repository. */
  openRepo(path: string): Promise<RepoSummary>
  recentRepos(): Promise<RecentRepo[]>
  removeRecent(path: string): Promise<RecentRepo[]>
  status(repoPath: string): Promise<ChangedFile[]>
  branches(repoPath: string): Promise<BranchInfo>
  checkout(repoPath: string, branch: string): Promise<BranchInfo>
  log(repoPath: string, options?: LogOptions): Promise<Commit[]>
  commitFiles(repoPath: string, hash: string): Promise<ChangedFile[]>
  workingDiff(repoPath: string, file: ChangedFile): Promise<DiffPayload>
  commitDiff(repoPath: string, hash: string, file: ChangedFile): Promise<DiffPayload>
  /** Build/runtime info for the About dialog. */
  appInfo(): Promise<AppInfo>
  /** Ask the main process to check the update feed. `manual` drives "up to date" UI. */
  checkForUpdates(manual: boolean): Promise<void>
  /** Quit and install a downloaded update. */
  installUpdate(): Promise<void>
  /** Minimize the window (custom title-bar control on Windows/Linux). */
  windowMinimize(): Promise<void>
  /** Toggle maximize/restore (custom title-bar control on Windows/Linux). */
  windowMaximizeToggle(): Promise<void>
  /** Close the window (custom title-bar control on Windows/Linux). */
  windowClose(): Promise<void>
  /** Current maximize state, for picking the maximize vs. restore glyph. */
  windowIsMaximized(): Promise<boolean>
  /** Top-level application-menu labels, for the custom always-visible menu bar. */
  menuLabels(): Promise<string[]>
  /** Open a top-level menu's native submenu anchored at window coords (x, y). */
  menuPopup(label: string, x: number, y: number): Promise<void>
  /** Subscribe to maximize/restore changes. Returns an unsubscribe fn. */
  onWindowMaximized(handler: (maximized: boolean) => void): () => void
  /** Subscribe to filesystem-driven repo change notifications. Returns an unsubscribe fn. */
  onRepoChanged(handler: (repoPath: string) => void): () => void
  /** Subscribe to the application menu "Open Repository" command. */
  onMenuOpenRepo(handler: () => void): () => void
  /** Subscribe to the "About GitGrove" menu command. */
  onShowAbout(handler: () => void): () => void
  /** Subscribe to auto-update lifecycle pushes. Returns an unsubscribe fn. */
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void
}

declare global {
  interface Window {
    gitgrove: GitGroveApi
  }
}
