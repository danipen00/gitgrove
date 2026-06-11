// Git LFS pointer handling for the diff pipeline.
//
// An LFS-tracked file is stored in the repository as a tiny pointer text:
//
//   version https://git-lfs.github.com/spec/v1
//   oid sha256:<64 hex chars>
//   size <bytes>
//
// Diffing such a file diffs the *pointers*, not the content: the committed
// side is the stored pointer, and the working-tree side runs through the
// clean filter first, so both sides come out as pointer text. Showing that
// raw oid/size churn to a user is meaningless — the diff layer detects the
// case (see read.ts) and renders a "Git LFS file" panel with the real object
// sizes instead. Pure functions, exported for tests.

/** The two facts a pointer carries that matter to the UI. */
export interface LfsPointer {
  oid: string
  /** Size of the actual LFS object (bytes) — not the pointer file. */
  size: number
}

/** What an LFS pointer-to-pointer patch means: the object size on each side
 *  (null = the file doesn't exist on that side: added or deleted). */
export interface LfsPatchInfo {
  oldSize: number | null
  newSize: number | null
}

// The spec requires `version` to be the first key; hawser is LFS's pre-1.0
// name and still appears in old repositories.
const VERSION_LINE = /^version https:\/\/(git-lfs|hawser)\.github\.com\/spec\/v\d+$/
const OID_LINE = /^oid sha256:[0-9a-f]{64}$/
const SIZE_LINE = /^size (\d+)$/
const KEY_VALUE_LINE = /^[a-z0-9.-]+ \S.*$/

/**
 * Parse file contents as an LFS pointer. Strict on the spec — first line is
 * the version, an oid and a size are present, and every line is `key value` —
 * so ordinary text that merely mentions LFS never matches.
 */
export function parseLfsPointer(contents: string): LfsPointer | null {
  // Pointers are tiny by definition (the spec caps them at 1024 bytes); a
  // cheap length gate keeps real file contents out of the line parser.
  if (contents.length === 0 || contents.length > 1024) return null
  const lines = contents.replace(/\n$/, '').split('\n')
  if (!VERSION_LINE.test(lines[0])) return null
  let oid: string | null = null
  let size: number | null = null
  for (const line of lines.slice(1)) {
    if (!KEY_VALUE_LINE.test(line)) return null
    if (OID_LINE.test(line)) oid = line.slice('oid '.length)
    const m = line.match(SIZE_LINE)
    if (m) size = Number(m[1])
  }
  return oid !== null && size !== null ? { oid, size } : null
}

/**
 * Inspect a unified patch and report LFS object sizes when it is a pure
 * pointer change. Pointer files are only a few lines, so the patch always
 * contains both sides in full — they can be reconstructed exactly.
 *
 * Returns null unless every present side is a valid pointer: a text file
 * being *migrated* to LFS diffs real content against a pointer, and that
 * change deserves the raw diff, not an LFS panel.
 */
export function describeLfsPatch(patch: string): LfsPatchInfo | null {
  // Fast gate: zero cost on the overwhelmingly common non-LFS patch.
  if (!patch.includes('version https://')) return null

  const oldLines: string[] = []
  const newLines: string[] = []
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) newLines.push(line.slice(1))
    else if (line.startsWith('-')) oldLines.push(line.slice(1))
    else if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    }
  }

  const oldPointer = oldLines.length > 0 ? parseLfsPointer(oldLines.join('\n')) : null
  const newPointer = newLines.length > 0 ? parseLfsPointer(newLines.join('\n')) : null
  // Every present side must parse; at least one side must exist.
  if (oldLines.length > 0 && !oldPointer) return null
  if (newLines.length > 0 && !newPointer) return null
  if (!oldPointer && !newPointer) return null
  return { oldSize: oldPointer?.size ?? null, newSize: newPointer?.size ?? null }
}
