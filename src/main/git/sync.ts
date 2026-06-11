// Network git operations: fetch, pull, push and clone. Fetch and push never
// touch the index, so they deliberately skip the write queue — a slow network
// operation must never make a one-file stage wait behind it. Pull rewrites
// the working tree, so it queues like any other write.
//
// These are the only operations that can need credentials, so they alone get
// `askpassEnv()`: prompts surface as the in-app credential dialog instead of
// failing on the disabled terminal prompt (see askpass.ts). Local writes
// never prompt and never get it. Auth failures are rethrown with a human
// message — git's raw stderr dump stays out of the toast.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { askpassEnv } from './askpass'
import { friendlyAuthError } from './askpass-prompt'
import { locateGit } from './bin'
import { type ProgressHandler, parseProgressText, run, runOnce } from './exec'

export async function fetch(
  repoPath: string,
  remote?: string,
  onProgress?: ProgressHandler,
  opts: { quiet?: boolean } = {}
): Promise<void> {
  const args = ['fetch', '--prune', '--progress']
  if (remote) args.push(remote)
  // Quiet fetches (the renderer's background timer) never prompt: without
  // GIT_ASKPASS the disabled terminal prompt makes git fail fast and silent —
  // a timer must never pop a credential dialog under the user.
  const env = opts.quiet ? {} : await askpassEnv()
  await runOnce(repoPath, args, { onProgress, env }).catch(rethrowFriendly(env))
}

export async function pull(
  repoPath: string,
  opts: { rebase?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['-c', 'core.editor=true', 'pull', '--progress']
  if (opts.rebase) args.push('--rebase')
  const env = await askpassEnv()
  await run(repoPath, args, { onProgress, env }).catch(rethrowFriendly(env))
}

export async function push(
  repoPath: string,
  opts: { setUpstream?: { remote: string; branch: string }; forceWithLease?: boolean } = {},
  onProgress?: ProgressHandler
): Promise<void> {
  const args = ['push', '--progress']
  if (opts.forceWithLease) args.push('--force-with-lease')
  if (opts.setUpstream) args.push('-u', opts.setUpstream.remote, opts.setUpstream.branch)
  const env = await askpassEnv()
  await runOnce(repoPath, args, { onProgress, env }).catch(rethrowFriendly(env))
}

/**
 * Re-throw with a human auth message when the failure is credential-related.
 * `env` is the askpass environment that was applied — empty when setup failed
 * or the op was quiet, which tells friendlyAuthError not to read git's
 * "terminal prompts disabled" as a user cancellation.
 */
function rethrowFriendly(env: Record<string, string>): (e: unknown) => never {
  const askpassActive = Object.keys(env).length > 0
  return (e) => {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(friendlyAuthError(message, askpassActive) ?? message)
  }
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
  const credentialEnv = await askpassEnv()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['clone', '--progress', '--recurse-submodules', url, dest], {
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...credentialEnv }
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
        const reason = lines.slice(-3).join('\n') || 'git clone failed'
        const askpassActive = Object.keys(credentialEnv).length > 0
        reject(new Error(friendlyAuthError(stderrTail, askpassActive) ?? reason))
      }
    })
  })
  return dest
}
