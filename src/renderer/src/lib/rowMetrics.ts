// Pure row geometry for the virtual scroller (components/common/VirtualScroll).
//
// Kept React-free so the windowing math — the part that's subtle to get right
// once rows can differ in height — is unit-testable in isolation, without
// driving the hook or the DOM.
//
// Two modes:
//   • Uniform rows (rowHeight is a number): pure arithmetic, no allocation.
//   • Variable rows (rowHeight is a function): a prefix-sum of offsets, built
//     once, so `rowTop` stays O(1) and `indexAt` is a binary search O(log n).

/** Per-row height (px): a constant, or a function of the row index. */
export type RowHeight = number | ((index: number) => number)

export interface RowMetrics {
  /** Combined height of all rows (px); excludes the list's outer padding. */
  total: number
  /** Top offset of row `index` within the content (px); defined for 0..count. */
  rowTop: (index: number) => number
  /** Height of row `index` (px). */
  heightOf: (index: number) => number
  /** Index of the row spanning content offset `y`, clamped to [0, count-1].
   *  Returns 0 when there are no rows. */
  indexAt: (y: number) => number
  /** Representative row height (px) for line-mode wheel deltas — the exact row
   *  doesn't matter, only a sane scroll step. */
  averageHeight: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

export function rowMetrics(count: number, rowHeight: RowHeight): RowMetrics {
  if (typeof rowHeight === 'number') {
    const h = rowHeight
    return {
      total: count * h,
      rowTop: (i) => clamp(i, 0, count) * h,
      heightOf: () => h,
      indexAt: (y) => (count === 0 ? 0 : clamp(Math.floor(y / h), 0, count - 1)),
      averageHeight: h
    }
  }
  // offsets[i] = summed height of rows [0, i); offsets[count] = total height.
  // Heights are positive, so offsets is strictly increasing — a clean binary
  // search target.
  const offsets = new Array<number>(count + 1)
  offsets[0] = 0
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + rowHeight(i)
  const total = offsets[count]
  return {
    total,
    rowTop: (i) => offsets[clamp(i, 0, count)],
    heightOf: (i) => {
      const c = clamp(i, 0, count - 1)
      return offsets[c + 1] - offsets[c]
    },
    indexAt: (y) => rowIndexAt(offsets, count, y),
    averageHeight: count === 0 ? 0 : total / count
  }
}

/** Largest index `i` in [0, count-1] whose row starts at or before `y`. */
function rowIndexAt(offsets: number[], count: number, y: number): number {
  if (count === 0) return 0
  if (y <= 0) return 0
  if (y >= offsets[count]) return count - 1
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Half-open row window [start, end) covering the viewport plus `overscan`
 *  rows on each side. `padTop` is the empty space above the first row. */
export function windowRange(
  metrics: RowMetrics,
  count: number,
  scrollTop: number,
  viewportH: number,
  overscan: number,
  padTop: number
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 }
  const y = scrollTop - padTop
  const start = Math.max(0, metrics.indexAt(y) - overscan)
  // Index the viewport's last visible pixel, not its exclusive bottom edge, so
  // a viewport that ends exactly on a row boundary doesn't pull in the next
  // (zero-pixel) row.
  const lastVisible = metrics.indexAt(y + Math.max(0, viewportH - 1))
  const end = Math.min(count, lastVisible + 1 + overscan)
  return { start, end }
}
