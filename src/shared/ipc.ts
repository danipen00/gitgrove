// Central registry of IPC channel names and the typed shape of the API the
// preload script exposes on `window.gitgrove`. Both the main process handlers
// and the renderer client import from here so the contract stays in one place.

import type {
  AppInfo,
  BranchInfo,
  ChangedFile,
  CloneProgress,
  Commit,
  CommitSelection,
  DiffArea,
  DiffPayload,
  DiscardItem,
  GitAvailability,
  LogOptions,
  OpProgress,
  RebaseTodoItem,
  RecentRepo,
  RepoOpenResult,
  RepoOpKind,
  ResetMode,
  StashEntry,
  SubmoduleInfo,
  UpdateStatus,
  WorktreeInfo
} from './types'

export const IPC = {
  pickRepo: 'repo:pick',
  openRepo: 'repo:open',
  trustRepo: 'repo:trust',
  recentRepos: 'repo:recent',
  removeRecent: 'repo:recent:remove',
  remoteUrl: 'repo:remote-url',
  revealRepo: 'repo:reveal',
  openTerminal: 'repo:terminal',
  snapshot: 'repo:snapshot',
  branches: 'repo:branches',
  checkout: 'repo:checkout',
  log: 'repo:log',
  commitFiles: 'repo:commit:files',
  workingDiff: 'repo:diff:working',
  commitDiff: 'repo:diff:commit',
  // staging & commits
  discardFiles: 'repo:discard',
  ignorePatterns: 'repo:ignore',
  applyPatch: 'repo:apply-patch',
  commit: 'repo:commit',
  lastCommitMessage: 'repo:last-commit-message',
  // sync
  fetch: 'repo:fetch',
  pull: 'repo:pull',
  push: 'repo:push',
  // branches
  createBranch: 'repo:branch:create',
  deleteBranch: 'repo:branch:delete',
  renameBranch: 'repo:branch:rename',
  checkoutDetached: 'repo:checkout-detached',
  // merge / rebase / history surgery
  merge: 'repo:merge',
  rebase: 'repo:rebase',
  rebaseInteractive: 'repo:rebase-interactive',
  cherryPick: 'repo:cherry-pick',
  revertCommit: 'repo:revert',
  reset: 'repo:reset',
  continueOp: 'repo:op:continue',
  abortOp: 'repo:op:abort',
  skipRebaseCommit: 'repo:op:skip',
  resolveConflict: 'repo:conflict:resolve',
  markResolved: 'repo:conflict:mark-resolved',
  openFileInEditor: 'repo:open-file',
  // stash
  stashList: 'repo:stash:list',
  stashFiles: 'repo:stash:files',
  stashSave: 'repo:stash:save',
  stashApply: 'repo:stash:apply',
  stashDrop: 'repo:stash:drop',
  // tags
  createTag: 'repo:tag:create',
  deleteTag: 'repo:tag:delete',
  // worktrees & submodules
  worktreeList: 'repo:worktree:list',
  worktreeAdd: 'repo:worktree:add',
  worktreeRemove: 'repo:worktree:remove',
  submoduleList: 'repo:submodule:list',
  submoduleUpdate: 'repo:submodule:update',
  optimizeRepo: 'repo:optimize',
  selectionSize: 'repo:selection-size',
  // clone
  cloneRepo: 'repo:clone',
  pickDirectory: 'app:pick-directory',
  // environment / app / updates
  checkGit: 'git:check',
  openExternal: 'app:open-external',
  clipboardWrite: 'app:clipboard-write',
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
  /** Generic application-menu command (payload: a MenuCommand string). */
  menuCommand: 'menu:command',
  cloneProgress: 'repo:clone-progress',
  /** Determinate progress of a running checkout/fetch/pull/push (OpProgress). */
  opProgress: 'repo:op-progress',
  updateStatus: 'update:status',
  windowMaximized: 'window:maximized'
} as const

/** Commands the application menu sends to the renderer to act on. */
export type MenuCommand =
  | 'clone'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'new-branch'
  | 'stash'
  | 'worktrees'
  | 'submodules'
  | 'optimize'

export interface GitGroveApi {
  /** Host platform, resolved synchronously at preload so the UI can branch on it. */
  platform: NodeJS.Platform
  /** Open the native folder picker; resolves null if cancelled, else the outcome. */
  pickRepo(): Promise<RepoOpenResult | null>
  /** Open a known path as a repository. */
  openRepo(path: string): Promise<RepoOpenResult>
  /** Trust a folder git flagged as untrusted (persist a safe.directory exception), then open it. */
  trustRepo(path: string): Promise<RepoOpenResult>
  recentRepos(): Promise<RecentRepo[]>
  removeRecent(path: string): Promise<RecentRepo[]>
  /** Resolve the repo's remote to a browsable web URL, or null if it has none. */
  remoteUrl(repoPath: string): Promise<string | null>
  /** Open the repo folder in the OS file manager (Finder/Explorer/…). */
  revealRepo(repoPath: string): Promise<boolean>
  /** Open a terminal rooted at the repo. Resolves false if none could launch. */
  openTerminal(repoPath: string): Promise<boolean>
  /**
   * One-call refresh payload: files, branch, sync counts, op state, stashes.
   * JSON-encoded (`RepoSnapshot`) so huge change lists cross the IPC and
   * contextBridge boundaries as one cheap string copy — parse on the caller's
   * side of the bridge, never in the preload world.
   */
  snapshot(repoPath: string): Promise<string>
  branches(repoPath: string): Promise<BranchInfo>
  checkout(repoPath: string, branch: string): Promise<BranchInfo>
  log(repoPath: string, options?: LogOptions): Promise<Commit[]>
  commitFiles(repoPath: string, hash: string): Promise<ChangedFile[]>
  workingDiff(repoPath: string, file: ChangedFile, area?: DiffArea): Promise<DiffPayload>
  commitDiff(repoPath: string, hash: string, file: ChangedFile): Promise<DiffPayload>
  // ── Staging & commits ──
  /**
   * Discard changes so the chosen paths end up exactly as in HEAD: staged
   * state is reset, original files are restored, and files HEAD doesn't have
   * (untracked, staged-new, rename targets) move to the OS trash so a
   * mis-click is recoverable.
   */
  discardFiles(repoPath: string, files: DiscardItem[], untrackedPaths: string[]): Promise<void>
  /**
   * Append gitignore pattern lines to the repo root's `.gitignore` (created if
   * missing); lines already present are skipped. Patterns are built in the
   * renderer — see lib/ignore.ts.
   */
  ignorePatterns(repoPath: string, patterns: string[]): Promise<void>
  /** Apply a (hunk) patch to the index/working tree — see git/write.ts applyPatch. */
  applyPatch(
    repoPath: string,
    patch: string,
    opts: { cached?: boolean; reverse?: boolean }
  ): Promise<void>
  /** Commit the checkbox selection — see git/write.ts commitSelection. */
  commit(repoPath: string, message: string, selection: CommitSelection): Promise<void>
  lastCommitMessage(repoPath: string): Promise<string>
  // ── Sync ──
  fetch(repoPath: string, remote?: string): Promise<void>
  pull(repoPath: string, opts?: { rebase?: boolean }): Promise<void>
  push(
    repoPath: string,
    opts?: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean }
  ): Promise<void>
  // ── Branches ──
  createBranch(
    repoPath: string,
    name: string,
    opts?: { from?: string; checkout?: boolean }
  ): Promise<void>
  deleteBranch(repoPath: string, name: string, opts?: { force?: boolean }): Promise<void>
  renameBranch(repoPath: string, from: string, to: string): Promise<void>
  checkoutDetached(repoPath: string, hash: string): Promise<void>
  // ── Merge / rebase / history surgery ──
  merge(repoPath: string, branch: string): Promise<void>
  rebase(repoPath: string, onto: string): Promise<void>
  rebaseInteractive(repoPath: string, base: string, items: RebaseTodoItem[]): Promise<void>
  cherryPick(repoPath: string, hash: string): Promise<void>
  revertCommit(repoPath: string, hash: string): Promise<void>
  reset(repoPath: string, hash: string, mode: ResetMode): Promise<void>
  continueOp(repoPath: string, op: RepoOpKind): Promise<void>
  abortOp(repoPath: string, op: RepoOpKind): Promise<void>
  skipRebaseCommit(repoPath: string): Promise<void>
  resolveConflict(repoPath: string, path: string, side: 'ours' | 'theirs'): Promise<void>
  markResolved(repoPath: string, path: string): Promise<void>
  /** Open a repo file with the OS default application. */
  openFileInEditor(repoPath: string, path: string): Promise<void>
  // ── Stash ──
  stashList(repoPath: string): Promise<StashEntry[]>
  stashSave(
    repoPath: string,
    opts?: { message?: string; includeUntracked?: boolean; paths?: string[] }
  ): Promise<void>
  /**
   * Files of a stash: tracked changes (vs the stash's first parent) plus the
   * untracked files git stores in the stash's third parent, marked untracked.
   */
  stashFiles(repoPath: string, sha: string): Promise<ChangedFile[]>
  stashApply(repoPath: string, index: number, pop: boolean): Promise<void>
  stashDrop(repoPath: string, index: number): Promise<void>
  // ── Tags ──
  createTag(
    repoPath: string,
    name: string,
    opts?: { hash?: string; message?: string; push?: boolean }
  ): Promise<void>
  deleteTag(repoPath: string, name: string): Promise<void>
  // ── Worktrees & submodules ──
  worktreeList(repoPath: string): Promise<WorktreeInfo[]>
  worktreeAdd(
    repoPath: string,
    path: string,
    opts?: { branch?: string; newBranch?: string }
  ): Promise<void>
  worktreeRemove(repoPath: string, path: string, opts?: { force?: boolean }): Promise<void>
  submoduleList(repoPath: string): Promise<SubmoduleInfo[]>
  submoduleUpdate(repoPath: string): Promise<void>
  /** Enable git's large-repo features (fsmonitor, untracked cache, index v4). */
  optimizeRepo(repoPath: string): Promise<void>
  /** Sum of the on-disk sizes (bytes) of the given repo-relative paths. */
  selectionSize(repoPath: string, paths: string[]): Promise<number>
  // ── Clone ──
  /**
   * Clone `url` into `parentDir`; progress arrives via onCloneProgress.
   * Resolves to the path of the new repository.
   */
  cloneRepo(url: string, parentDir: string): Promise<string>
  /** Open the native directory picker; null when cancelled. */
  pickDirectory(title?: string): Promise<string | null>
  /**
   * Check whether git is available. Pass `force` to re-probe after the user has
   * (e.g.) installed git, bypassing the cached result.
   */
  checkGit(force?: boolean): Promise<GitAvailability>
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>
  /** Write text to the system clipboard. */
  clipboardWrite(text: string): Promise<void>
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
  /** Subscribe to generic application-menu commands (fetch, pull, stash, …). */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  /** Subscribe to clone progress pushes while a clone runs. */
  onCloneProgress(handler: (progress: CloneProgress) => void): () => void
  /** Subscribe to determinate progress of running checkout/fetch/pull/push ops. */
  onOpProgress(handler: (progress: OpProgress) => void): () => void
  /** Subscribe to auto-update lifecycle pushes. Returns an unsubscribe fn. */
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void
}

declare global {
  interface Window {
    gitgrove: GitGroveApi
  }
}
