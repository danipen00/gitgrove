// Split a unified git patch into per-hunk mini-patches so each hunk can be
// staged / unstaged / discarded independently (`git apply --cached` takes a
// patch on stdin). Pure string work — unit-tested in patch.test.ts.

export interface PatchHunk {
  /** The `@@ -a,b +c,d @@ …` line, useful for labels. */
  header: string
  /** Count of added/removed lines, for the hunk action bar. */
  additions: number
  deletions: number
  /** A complete, standalone patch containing just this hunk. */
  patch: string
}

/**
 * Split `patch` into its file header and one standalone patch per hunk.
 * Returns an empty hunk list for binary / empty patches, in which case hunk
 * actions are not offered and the caller renders the patch as-is.
 *
 * Rename-only patches have a header but no hunks; mode-change lines are kept
 * in the header so the mini-patches stay valid for `git apply`.
 */
export function splitPatchHunks(patch: string): PatchHunk[] {
  if (!patch.trim() || /^Binary files |GIT binary patch/m.test(patch)) return []

  const lines = patch.split('\n')
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'))
  if (firstHunk === -1) return []

  const header = lines.slice(0, firstHunk)
  const hunks: PatchHunk[] = []
  let current: string[] | null = null

  const push = () => {
    if (!current) return
    let additions = 0
    let deletions = 0
    for (const l of current) {
      if (l.startsWith('+')) additions++
      else if (l.startsWith('-')) deletions++
    }
    hunks.push({
      header: current[0],
      additions,
      deletions,
      patch: `${[...header, ...current].join('\n')}\n`
    })
  }

  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@')) {
      push()
      current = [line]
    } else if (current) {
      // Keep context/added/removed/no-newline lines; drop the trailing ''.
      if (line === '' && current[current.length - 1] === '') continue
      current.push(line)
    }
  }
  // Trim a trailing empty line left by the final split('\n').
  if (current && current[current.length - 1] === '') current.pop()
  push()

  return hunks
}
