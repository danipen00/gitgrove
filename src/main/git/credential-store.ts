// Purging a host's credentials from git's configured credential helpers
// (osxkeychain, manager, libsecret, …). Context: git consults helpers BEFORE
// askpass, and on a successful network op it stores whatever credential was
// used back into them. So after sign-out — or when a fresh token replaces an
// old one — a stale helper copy would keep answering for the host (until it
// 401s). `git credential reject` fans the erase request out to every
// configured helper, making account changes take effect immediately.

import { homedir } from 'node:os'
import { runOnce } from './exec'

export async function rejectStoredCredential(host: string): Promise<void> {
  // credential commands need no repository — run from the home directory so
  // local config can't interfere. The trailing blank line ends the
  // key=value description block (git's credential wire format).
  const description = `protocol=https\nhost=${host}\n\n`
  // Best-effort: a missing/failing helper must never break sign-out itself.
  await runOnce(homedir(), ['credential', 'reject'], { input: description }).catch(() => {})
}
