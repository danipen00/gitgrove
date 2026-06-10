// Network git operations: fetch, pull, push and clone. Fetch and push never
// touch the index, so they deliberately skip the write queue — a slow network
// operation must never make a one-file stage wait behind it. Pull rewrites
// the working tree, so it queues like any other write.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { locateGit } from './bin'
import { type ProgressHandler, parseProgressText, run, runOnce } from './exec'

export async function fetch(
  repoPath: string,
  remote?: string,
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['fetch', '--prune', '--progress']
  if (remote) args.push(remote)
  await runOnce(repoPath, args, { onProgress })
}

export async function pull(
  repoPath: string,
  opts: { rebase?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['-c', 'core.editor=true', 'pull', '--progress']
  if (opts.rebase) args.push('--rebase')
  await run(repoPath, args, { onProgress })
}

export async function push(
  repoPath: string,
  opts: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['push', '--progress']
  if (opts.forceWithLease) args.push('--force-with-lease')
  if (opts.setUpstream) args.push('-u', opts.setUpstream.remote, opts.setUpstream.branch)
  await runOnce(repoPath, args, { onProgress })
}

/**
 * Clone with progress. git reports progress on stderr as lines like
 * "Receiving objects:  42% (1234/2934)"; we forward phase + percent to the
 * caller. Resolves with the path of the new repo.
 */
export async function clone(
  url: string,
  parentDir: string,
  onProgress: ProgressHandler
): Promise<string> {
  const name = (url.split('/').pop() ?? 'repository').replace(/\.git$/, '') || 'repository'
  const dest = join(parentDir, name)
  const bin = await locateGit()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['clone', '--progress', '--recurse-submodules', url, dest], {
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    let stderrTail = ''
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderrTail = (stderrTail + text).slice(-4000)
      parseProgressText(text, onProgress)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        // The tail of stderr holds the human-readable failure (auth, 404, …).
        const lines = stderrTail.split('\n').filter((l) => l.trim() && !/\d+%/.test(l))
        reject(new Error(lines.slice(-3).join('\n') || 'git clone failed'))
      }
    })
  })
  return dest
}
