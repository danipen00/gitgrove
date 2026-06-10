// Locating a usable `git` executable.
//
// GitGrove shells out to git for every operation (via execFile and spawn),
// which assumes `git` is discoverable on PATH. That assumption breaks for a
// large class of users:
//   • A GUI app launched from Explorer / Finder / the Dock inherits the *login*
//     PATH, not a shell's PATH, so a git that only a terminal can see is
//     invisible to the app.
//   • Many people never install standalone git at all — their only copy is the
//     one bundled inside GitHub Desktop, which is never placed on PATH.
// When git can't be spawned, every command fails with ENOENT and the app would
// otherwise misreport it as "not a git repository". This module finds a working
// git: it trusts PATH first, then probes well-known install locations, and
// caches the answer for the lifetime of the process.

import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Thrown when no usable git executable can be found anywhere we look. */
export class GitNotFoundError extends Error {
  constructor() {
    super(
      "Git wasn't found on your system. Install Git from https://git-scm.com (or make sure it is on your PATH) and reopen GitGrove."
    )
    this.name = 'GitNotFoundError'
  }
}

let cached: Promise<string> | null = null

/**
 * Resolve the git executable to use, cached after the first success. Returns
 * the value to pass as the binary to execFile / spawn: `'git'` when PATH
 * already works, otherwise an absolute path. When git is found off PATH its
 * directory is prepended to `process.env.PATH` so anything git itself shells
 * out to (hooks, pager, helpers) resolves too. Rejects with
 * {@link GitNotFoundError} when nothing usable is found.
 *
 * A failed probe is not cached, so a later call (e.g. after the user installs
 * git and hits "Re-check") can succeed without restarting the app.
 */
export function locateGit(): Promise<string> {
  if (!cached) {
    const probe = resolve()
    cached = probe
    // Drop a rejected result so the next call retries instead of replaying the
    // failure; concurrent callers still share the one in-flight probe.
    probe.catch(() => {
      if (cached === probe) cached = null
    })
  }
  return cached
}

/** Forget a previously resolved git, forcing the next lookup to probe afresh. */
export function resetGitLocation(): void {
  cached = null
}

/** The installed git's version (e.g. `2.53.0`), via the resolved executable. */
export async function gitVersion(): Promise<string> {
  const bin = await locateGit()
  const { stdout } = await execFileAsync(bin, ['--version'], { windowsHide: true })
  // "git version 2.53.0.windows.3" -> "2.53.0.windows.3"
  return stdout.trim().replace(/^git version\s*/i, '')
}

async function resolve(): Promise<string> {
  // Trust PATH first: it respects the user's chosen git and is the common case.
  if (await canRun('git')) return 'git'

  for (const candidate of await knownLocations()) {
    if (await canRun(candidate)) {
      // Put it on PATH so git's own child processes can find git too.
      const dir = dirname(candidate)
      if (!process.env.PATH?.split(delimiter).includes(dir)) {
        process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
      }
      return candidate
    }
  }

  throw new GitNotFoundError()
}

/** Whether `<bin> --version` runs successfully. */
async function canRun(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Absolute git paths to probe, most-preferred first, for the current OS. */
function knownLocations(): Promise<string[]> {
  if (process.platform === 'win32') return windowsLocations()
  if (process.platform === 'darwin') {
    return Promise.resolve([
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/usr/bin/git',
      '/Applications/Xcode.app/Contents/Developer/usr/bin/git'
    ])
  }
  return Promise.resolve(['/usr/bin/git', '/usr/local/bin/git', '/bin/git'])
}

async function windowsLocations(): Promise<string[]> {
  const out: string[] = []
  const pf = process.env.ProgramFiles
  const pf86 = process.env['ProgramFiles(x86)']
  const local = process.env.LOCALAPPDATA
  if (pf) out.push(join(pf, 'Git', 'cmd', 'git.exe'))
  if (pf86) out.push(join(pf86, 'Git', 'cmd', 'git.exe'))
  if (local) {
    out.push(join(local, 'Programs', 'Git', 'cmd', 'git.exe'))
    // GitHub Desktop is the only git many users have; add its bundled copy.
    out.push(...(await githubDesktopGits(local)))
  }
  return out
}

/**
 * Git executables bundled inside GitHub Desktop installs, newest app version
 * first. The binary lives under a versioned `app-<semver>` directory and is
 * never placed on PATH, so we enumerate the install root to find it.
 */
async function githubDesktopGits(localAppData: string): Promise<string[]> {
  const base = join(localAppData, 'GitHubDesktop')
  let entries: string[]
  try {
    entries = await readdir(base)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.startsWith('app-'))
    .sort(byAppVersionDesc)
    .map((name) => join(base, name, 'resources', 'app', 'git', 'cmd', 'git.exe'))
}

/** Order `app-1.2.3` directory names newest-first by their numeric suffix. */
function byAppVersionDesc(a: string, b: string): number {
  const parse = (s: string) =>
    s
      .replace(/^app-/, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const av = parse(a)
  const bv = parse(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (bv[i] ?? 0) - (av[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
