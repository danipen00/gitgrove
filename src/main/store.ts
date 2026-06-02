// Tiny JSON-file store for "recently opened" repositories, kept in the app's
// userData directory so it survives restarts.

import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

import type { RecentRepo, RepoInfo } from '@shared/types'

const MAX_RECENT = 12

function storePath(): string {
  return join(app.getPath('userData'), 'recent-repos.json')
}

function read(): RecentRepo[] {
  try {
    const file = storePath()
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? (parsed as RecentRepo[]) : []
  } catch {
    return []
  }
}

function write(repos: RecentRepo[]): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(storePath(), JSON.stringify(repos, null, 2), 'utf8')
  } catch {
    // non-fatal: recents are a convenience only
  }
}

export function getRecentRepos(): RecentRepo[] {
  return read()
    .filter((r) => existsSync(r.path))
    .sort((a, b) => b.lastOpened - a.lastOpened)
}

export function rememberRepo(repo: RepoInfo): RecentRepo[] {
  const existing = read().filter((r) => r.path !== repo.path)
  const updated: RecentRepo[] = [{ ...repo, lastOpened: Date.now() }, ...existing].slice(0, MAX_RECENT)
  write(updated)
  return getRecentRepos()
}

export function removeRecentRepo(path: string): RecentRepo[] {
  write(read().filter((r) => r.path !== path))
  return getRecentRepos()
}
