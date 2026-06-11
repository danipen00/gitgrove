// Git LFS health detection and one-click setup.
//
// An LFS repo only works when two machine-local pieces exist: the `git-lfs`
// binary, and the smudge/clean filter configuration (`git lfs install`
// normally writes it). Clone an LFS repo on a machine missing either and
// nothing fails loudly — files just materialize as pointer text and pushes
// drop content. The renderer asks for this health on repo open and offers a
// one-click fix instead of letting the user discover the breakage later.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LfsHealth } from '@shared/types'
import { locateGitLfs } from './bin'
import { run } from './exec'
import { runGit } from './read'

/**
 * Whether `.gitattributes` content routes any pattern through the LFS filter.
 * Comments are stripped the way git strips them (a `#` starts a comment only
 * at line start). Pure + exported for tests.
 */
export function attributesUseLfs(text: string): boolean {
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue
    if (/(^|\s)filter=lfs(\s|$)/.test(line)) return true
  }
  return false
}

/** Attribute files inspected per repo — checking the LFS filter rarely needs
 *  more than the root file; the cap just bounds pathological repos. */
const MAX_ATTRIBUTE_FILES = 20

/**
 * Probe the three facts the renderer's LFS banner needs, concurrently (~one
 * status-call worth of time, run once per repo open). Tracked *and* untracked
 * `.gitattributes` files are inspected: a fresh `git lfs track` writes the
 * file before anything is committed.
 */
export async function getLfsHealth(repoPath: string): Promise<LfsHealth> {
  const [attrsOut, smudge, clean, binaryAvailable] = await Promise.all([
    runGit(repoPath, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '*.gitattributes'
    ]).catch(() => ''),
    // Any config scope counts: a global `git lfs install` covers every repo.
    runGit(repoPath, ['config', '--get', 'filter.lfs.smudge'], [1]).catch(() => ''),
    runGit(repoPath, ['config', '--get', 'filter.lfs.clean'], [1]).catch(() => ''),
    // Probe the binary directly, not `git lfs version`: `git lfs <cmd>` only
    // works once the `git-lfs` helper is on PATH, and a GUI-launched app's login
    // PATH often omits the dir it lives in (e.g. /opt/homebrew/bin). locateGitLfs
    // finds it and prepends that dir to PATH, fixing the probe and every later
    // `git lfs` call too.
    locateGitLfs()
  ])
  let usesLfs = false
  for (const path of attrsOut.split('\0').filter(Boolean).slice(0, MAX_ATTRIBUTE_FILES)) {
    const text = await readFile(join(repoPath, path), 'utf8').catch(() => '')
    if (attributesUseLfs(text)) {
      usesLfs = true
      break
    }
  }
  return {
    usesLfs,
    filtersConfigured: smudge.trim() !== '' && clean.trim() !== '',
    binaryAvailable
  }
}

/**
 * One-click LFS setup: `git lfs install` writes the global filter config and
 * this repo's hooks — the exact setup the banner detected as missing. Rides
 * the write queue: it touches .git/hooks and must not race another write.
 */
export async function enableLfs(repoPath: string): Promise<void> {
  // `git lfs install` spawns the `git-lfs` helper, so its dir must be on PATH
  // first — same login-PATH gap as the health probe. locateGitLfs prepends it.
  await locateGitLfs()
  await run(repoPath, ['lfs', 'install'])
}
