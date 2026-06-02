// Central registry of IPC channel names and the typed shape of the API the
// preload script exposes on `window.gitgrove`. Both the main process handlers
// and the renderer client import from here so the contract stays in one place.

import type {
  BranchInfo,
  ChangedFile,
  Commit,
  DiffPayload,
  LogOptions,
  RecentRepo,
  RepoSummary
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
  // main -> renderer pushes
  repoChanged: 'repo:changed',
  menuOpenRepo: 'menu:open-repo'
} as const

export interface GitGroveApi {
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
  /** Subscribe to filesystem-driven repo change notifications. Returns an unsubscribe fn. */
  onRepoChanged(handler: (repoPath: string) => void): () => void
  /** Subscribe to the application menu "Open Repository" command. */
  onMenuOpenRepo(handler: () => void): () => void
}

declare global {
  interface Window {
    gitgrove: GitGroveApi
  }
}
