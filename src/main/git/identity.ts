// Commit identity (user.name / user.email). git refuses to commit without
// both ("Please tell me who you are"), which on a fresh machine turns the
// very first commit into a cryptic dead end — the renderer probes with
// getIdentity before committing and collects the values with one dialog.

import type { GitIdentity, IdentityScope } from '@shared/types'
import { run, runRead } from './exec'

export async function getIdentity(repoPath: string): Promise<GitIdentity> {
  const [name, email] = await Promise.all([
    readScopedConfig(repoPath, 'user.name'),
    readScopedConfig(repoPath, 'user.email')
  ])
  if (!name || !email) {
    return { name: name?.value ?? '', email: email?.value ?? '', source: 'none' }
  }
  // For the UI, "local" means this repo overrides (worktree counts: it's even
  // more specific); everything broader — global, system, command line — reads
  // as the user's machine-wide identity.
  const isLocal = (scope: string) => scope === 'local' || scope === 'worktree'
  return {
    name: name.value,
    email: email.value,
    source: isLocal(name.scope) || isLocal(email.scope) ? 'local' : 'global'
  }
}

export async function setIdentity(
  repoPath: string,
  name: string,
  email: string,
  scope: IdentityScope
): Promise<void> {
  const scopeFlag = scope === 'global' ? '--global' : '--local'
  // Config writes lock the config file, not the index, but still serialize on
  // the repo's write queue so two GitGrove writes can't collide on it.
  await run(repoPath, ['config', scopeFlag, 'user.name', name])
  await run(repoPath, ['config', scopeFlag, 'user.email', email])
}

/**
 * One config value with the scope it came from. `--show-scope --get` prints
 * "<scope>\t<value>"; with multiple definitions git prints the winning (last)
 * one, which is exactly the value a commit would use. Exit code 1 = unset.
 */
async function readScopedConfig(
  repoPath: string,
  key: string
): Promise<{ scope: string; value: string } | null> {
  const out = await runRead(repoPath, ['config', '--show-scope', '--get', key], {
    tolerateExitCodes: [1]
  })
  const line = out.trimEnd()
  if (!line) return null
  const tab = line.indexOf('\t')
  if (tab === -1) return null
  const value = line.slice(tab + 1)
  return value ? { scope: line.slice(0, tab), value } : null
}
