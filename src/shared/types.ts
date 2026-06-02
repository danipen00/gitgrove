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
