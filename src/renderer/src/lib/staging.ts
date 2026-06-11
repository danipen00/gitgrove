// Selection-to-patch plumbing for the working diff.
//
// Checkboxes are pure renderer state — "include this in the next commit" —
// and git is only touched at commit time. Selection granularity is the
// *change block*: each contiguous run of added/removed lines gets its own
// checkbox, even when the display differ merges nearby blocks into one hunk
// (it joins changes closer than ~2× the context size). Every block can be
// rendered back into a standalone unified patch: apply it to a HEAD-equal
// index with `git apply --cached` to include it in a commit, or
// reverse-apply it to the working tree to discard it.
//
// Pure functions over the metadata shape @pierre/diffs produces; unit-tested
// and round-tripped through real `git apply`.

/**
 * The structural subset of @pierre/diffs' FileDiffMetadata we read. Declared
 * locally so this module (and its tests) stay dependency-free.
 */
export interface DisplayHunk {
  additionStart: number
  additionCount: number
  deletionStart: number
  deletionCount: number
  hunkContent: (
    | { type: 'context'; lines: number }
    | {
        type: 'change'
        deletions: number
        deletionLineIndex: number
        additions: number
        additionLineIndex: number
      }
  )[]
}

/** Full-contents line arrays of the displayed diff (isPartial === false). */
export interface DisplayMeta {
  deletionLines: string[]
  additionLines: string[]
  hunks: DisplayHunk[]
}

/** One contiguous run of changed lines — the unit of commit selection. */
export interface ChangeBlock {
  /** Ordinal across the whole file: the selection/annotation key. */
  index: number
  /** First old-side line of the block (insertion point for pure additions). */
  oldStart: number
  /** Removed line count (the block's `deletions` stat). */
  oldLines: number
  /** First new-side line of the block. */
  newStart: number
  /** Added line count (the block's `additions` stat). */
  newLines: number
  /** Where the block's selection bar anchors in the rendered diff. */
  anchor: { side: 'additions' | 'deletions'; lineNumber: number }
}

const NO_NEWLINE = '\\ No newline at end of file'

/**
 * @pierre/diffs keeps each line's trailing newline in its content arrays
 * (except a file's last line when the file has none — which is how we detect
 * it). Patch lines must not carry the newline; the joiner adds it. Only the
 * final `\n` is stripped — a `\r` from CRLF files stays, as git expects.
 */
const chomp = (line: string | undefined) => (line ?? '').replace(/\n$/, '')

const lacksFinalNewline = (lines: string[]) =>
  lines.length > 0 && !(lines[lines.length - 1] ?? '').endsWith('\n')

/** Enumerate every change block of the displayed diff, in display order. */
export function listChangeBlocks(meta: DisplayMeta): ChangeBlock[] {
  const blocks: ChangeBlock[] = []
  for (const hunk of meta.hunks) {
    let oldLine = hunk.deletionStart
    let newLine = hunk.additionStart
    let contextAbove = false
    for (const part of hunk.hunkContent) {
      if (part.type === 'context') {
        oldLine += part.lines
        newLine += part.lines
        contextAbove = part.lines > 0
        continue
      }
      // The bar sits on the rendered line just above the block when the hunk
      // shows one; otherwise on the block's first changed line (old side for
      // pure deletions — the new side has no line there).
      const anchor: ChangeBlock['anchor'] = contextAbove
        ? { side: 'additions', lineNumber: newLine - 1 }
        : part.additions > 0
          ? { side: 'additions', lineNumber: newLine }
          : { side: 'deletions', lineNumber: oldLine }
      blocks.push({
        index: blocks.length,
        oldStart: oldLine,
        oldLines: part.deletions,
        newStart: newLine,
        newLines: part.additions,
        anchor
      })
      oldLine += part.deletions
      newLine += part.additions
      contextAbove = false
    }
  }
  return blocks
}

/** Context lines included around a block patch (matches git's default). */
const BLOCK_CONTEXT = 3

/**
 * Render one change block into a standalone unified patch for `path`.
 * Old-side coordinates are HEAD's, new-side are the working tree's — exactly
 * what `git apply --cached` needs after the index was reset to HEAD, and what
 * `git apply --reverse` needs against the working tree. Context never crosses
 * into a neighboring block (those lines differ between the two sides).
 */
export function buildBlockPatch(
  path: string,
  meta: DisplayMeta,
  blocks: ChangeBlock[],
  index: number
): string {
  const block = blocks[index]
  const prevOldEnd = index > 0 ? blocks[index - 1].oldStart + blocks[index - 1].oldLines : 1
  const nextOldStart = blocks[index + 1]?.oldStart ?? meta.deletionLines.length + 1
  const lead = Math.min(BLOCK_CONTEXT, block.oldStart - prevOldEnd)
  const trail = Math.min(BLOCK_CONTEXT, nextOldStart - (block.oldStart + block.oldLines))

  const oldStart = block.oldStart - lead
  const newStart = block.newStart - lead
  const oldCount = lead + block.oldLines + trail
  const newCount = lead + block.newLines + trail

  const oldLast = meta.deletionLines.length
  const newLast = meta.additionLines.length
  const oldNoEOF = lacksFinalNewline(meta.deletionLines)
  const newNoEOF = lacksFinalNewline(meta.additionLines)

  const lines: string[] = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
  ]
  // Context lines are identical on both sides; read them from the old side
  // and mark a missing trailing newline when the context line ends a side.
  const pushContext = (oldLine: number) => {
    lines.push(` ${chomp(meta.deletionLines[oldLine - 1])}`)
    const newLine = oldLine - oldStart + newStart
    if ((oldNoEOF && oldLine === oldLast) || (newNoEOF && newLine === newLast)) {
      lines.push(NO_NEWLINE)
    }
  }
  for (let i = 0; i < lead; i++) pushContext(oldStart + i)
  for (let i = 0; i < block.oldLines; i++) {
    const line = block.oldStart + i
    lines.push(`-${chomp(meta.deletionLines[line - 1])}`)
    if (oldNoEOF && line === oldLast) lines.push(NO_NEWLINE)
  }
  for (let i = 0; i < block.newLines; i++) {
    const line = block.newStart + i
    lines.push(`+${chomp(meta.additionLines[line - 1])}`)
    if (newNoEOF && line === newLast) lines.push(NO_NEWLINE)
  }
  for (let i = 0; i < trail; i++) {
    const oldLine = block.oldStart + block.oldLines + i
    lines.push(` ${chomp(meta.deletionLines[oldLine - 1])}`)
    const newLine = block.newStart + block.newLines + i
    if ((oldNoEOF && oldLine === oldLast) || (newNoEOF && newLine === newLast)) {
      lines.push(NO_NEWLINE)
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * CSS for @pierre/diffs' `unsafeCSS` option that repaints the changed lines of
 * *excluded* blocks (checkbox off) with the **same flat gray as the unselected
 * "Include in commit" bar** (`--bg-panel`) — so the block and its header read as
 * one set-aside unit, still clearly a change but visibly not going into the
 * commit. Pierre paints line backgrounds in its shadow DOM, so we feed the rule
 * through `unsafeCSS`; it lands in pierre's last cascade layer (`@layer unsafe`),
 * so a plain `background-color` wins over the diff's green/red without any
 * specificity tricks. The word-level emphasis and the changed line numbers are
 * neutralized to the same gray/muted tone so nothing stays tinted.
 *
 * Each changed line is keyed by its line number on its own side, scoped to the
 * line type so old/new numbers never collide; both the content row
 * (`[data-line]`) and its gutter number cell (`[data-column-number]`) are grayed.
 * Returns '' when nothing is excluded, so the common "all included" case injects
 * no styles at all.
 */
export function buildExcludedDiffCss(
  blocks: ChangeBlock[],
  isExcluded: (blockIndex: number) => boolean
): string {
  const selectors: string[] = []
  const addLines = (type: 'change-addition' | 'change-deletion', start: number, count: number) => {
    for (let n = start; n < start + count; n++) {
      selectors.push(
        `[data-line-type="${type}"]:is([data-line="${n}"],[data-column-number="${n}"])`
      )
    }
  }
  for (const block of blocks) {
    if (!isExcluded(block.index)) continue
    addLines('change-addition', block.newStart, block.newLines)
    addLines('change-deletion', block.oldStart, block.oldLines)
  }
  if (selectors.length === 0) return ''
  return (
    `:is(${selectors.join(',')}){` +
    'background-color:var(--bg-panel);' +
    '--diffs-bg-addition-emphasis-override:var(--bg-panel);' +
    '--diffs-bg-deletion-emphasis-override:var(--bg-panel);' +
    '--diffs-fg-number-addition-override:var(--fg-muted);' +
    '--diffs-fg-number-deletion-override:var(--fg-muted)}'
  )
}
