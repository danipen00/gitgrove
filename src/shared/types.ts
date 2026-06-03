// Types shared between the Electron main process, the preload bridge, and the
// React renderer. Keep this file free of any runtime dependencies so it can be
// imported from every bundle.

/** Git status as understood by @pierre/trees' gitStatus API. */
export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored'
  | 'conflicted'

export interface ChangedFile {
  /** Repo-relative POSIX path. For renames this is the new path. */
  path: string
  /** Previous path for renames/copies. */
  oldPath?: string
  status: FileStatus
  /** True when the change is staged in the index. */
  staged: boolean
  /** True when the file has both staged and unstaged portions. */
  partiallyStaged?: boolean
  insertions?: number
  deletions?: number
  /** True when git considers the blob binary. */
  binary?: boolean
}

export interface Commit {
  hash: string
  shortHash: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  /** ISO date string. */
  date: string
  relativeDate: string
  refs: string
  parents: string[]
}

export interface BranchInfo {
  current: string
  detached: boolean
  local: string[]
  remote: string[]
}

export interface RepoInfo {
  path: string
  name: string
}

export interface RepoSummary extends RepoInfo {
  branch: BranchInfo
  /** Number of uncommitted changes in the working tree. */
  changeCount: number
  ahead: number
  behind: number
}

export interface RecentRepo extends RepoInfo {
  lastOpened: number
}

/**
 * Outcome of trying to open a repo. Expected, recoverable cases are modelled as
 * data (not thrown) so the renderer can react: `not-git` shows an error,
 * `untrusted` (git "dubious ownership") prompts the user to trust the folder.
 */
export type RepoOpenResult =
  | { ok: true; summary: RepoSummary }
  | { ok: false; reason: 'not-git' | 'untrusted'; path: string }

export interface LogOptions {
  /** Branch / ref to read history from. Defaults to the checked-out branch. */
  ref?: string
  limit?: number
  skip?: number
  /** Free-text search across commit messages. */
  search?: string
}

/** A single file's unified diff plus light metadata for the diff viewer. */
export interface DiffPayload {
  /** Unified git patch (with `diff --git` header), or empty when not diffable. */
  patch: string
  path: string
  oldPath?: string
  status: FileStatus
  binary: boolean
  /** Set when the file is too large / binary and no patch is produced. */
  notice?: string
  language?: string
  /**
   * Full old/new file contents. When both are present the diff viewer renders
   * with @pierre/diffs' MultiFileDiff so collapsed context becomes expandable
   * (PatchDiff alone only has the patch's limited context). Omitted for binary,
   * too-large, or unreadable files, in which case the viewer falls back to the
   * non-expandable patch render.
   */
  oldContents?: string
  newContents?: string
}

export interface AppError {
  message: string
  detail?: string
}

/**
 * Whether a usable `git` executable was found, used to gate the UI: when git is
 * missing the renderer shows a guided setup screen instead of letting the user
 * hit cryptic failures on every repo action.
 */
export interface GitAvailability {
  available: boolean
  /** Resolved git version (e.g. `2.53.0`) when available. */
  version?: string
  /** Path / command used to invoke git (`'git'` when found on PATH). */
  path?: string
  /** Host platform, so the setup screen can show OS-specific install guidance. */
  platform: NodeJS.Platform
}

/** Static information about the running build, surfaced in the About dialog. */
export interface AppInfo {
  name: string
  version: string
  /** Electron / Chromium / Node / V8 runtime versions. */
  electron: string
  chrome: string
  node: string
  v8: string
  platform: NodeJS.Platform
  arch: string
  /** False when running a packaged build, true under `electron-vite dev`. */
  dev: boolean
  /** Canonical repository URL for "View on GitHub" links. */
  repoUrl: string
}

/** Lifecycle of an auto-update check, pushed from main to the renderer. */
export type UpdateState =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  /**
   * The update finished downloading but can't be auto-installed: an unsigned
   * macOS build, which Squirrel.Mac refuses to validate. The user finishes by
   * opening the downloaded installer (.dmg) themselves — see `downloadedFile`.
   */
  | 'manual-install'
  | 'error'
  /** Reported for manual checks while running an unpackaged dev build. */
  | 'dev'

export interface UpdateStatus {
  state: UpdateState
  /** The currently running version. */
  version: string
  /** The version offered by the feed (available / downloaded states). */
  newVersion?: string
  /** Release notes for the offered version, flattened to plain text. */
  notes?: string
  /** Download progress 0–100 (downloading state). */
  percent?: number
  bytesPerSecond?: number
  /** Absolute path to the downloaded installer (manual-install state). */
  downloadedFile?: string
  error?: string
  /**
   * True when the user explicitly asked to check (menu / About button). Lets the
   * renderer stay silent about "up to date" results from background checks.
   */
  manual: boolean
}
