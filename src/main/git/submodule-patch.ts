// Submodule entries in the diff pipeline.
//
// A submodule is a gitlink (mode 160000): the parent repo stores only the
// commit the submodule points at, so its diff is the literal text
//
//   -Subproject commit <old sha>
//   +Subproject commit <new sha>[-dirty]
//
// (`-dirty` when the submodule's own working tree has uncommitted changes).
// That raw text is git plumbing, not a diff a user should read — the diff
// layer detects it (see read.ts) and ships the structured facts instead, so
// the viewer can render a "Submodule updated: abc1234 → def5678" panel.
// Pure + exported for tests.

/** What a submodule (gitlink) patch says: the commit movement. */
export interface SubmodulePatchInfo {
  /** Commit before the change; null when the submodule was just added. */
  oldSha: string | null
  /** Commit after the change; null when the submodule was removed. */
  newSha: string | null
  /** True when the submodule's own working tree has uncommitted changes. */
  dirty: boolean
}

const OLD_LINE = /^-Subproject commit ([0-9a-f]{4,64})(-dirty)?$/
const NEW_LINE = /^\+Subproject commit ([0-9a-f]{4,64})(-dirty)?$/

/**
 * Inspect a unified patch and report the commit movement when it is a pure
 * gitlink change. Returns null for anything else — including patches that
 * merely contain "Subproject commit" as file content, which is why every
 * changed line must match, not just one.
 */
export function describeSubmodulePatch(patch: string): SubmodulePatchInfo | null {
  // Fast gate: zero cost on ordinary patches.
  if (!patch.includes('Subproject commit ')) return null

  let oldSha: string | null = null
  let newSha: string | null = null
  let dirty = false
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk || !line) continue
    if (line.startsWith('-')) {
      const m = line.match(OLD_LINE)
      if (!m || oldSha !== null) return null
      oldSha = m[1]
    } else if (line.startsWith('+')) {
      const m = line.match(NEW_LINE)
      if (!m || newSha !== null) return null
      newSha = m[1]
      if (m[2]) dirty = true
    } else if (line.startsWith(' ')) {
      // A gitlink diff has no context lines — real file content does.
      return null
    }
  }
  if (oldSha === null && newSha === null) return null
  return { oldSha, newSha, dirty }
}
