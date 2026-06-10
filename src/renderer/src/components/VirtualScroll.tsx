// Shared main-thread virtual scroller for the windowed lists (working files,
// branch switcher).
//
// Why not native overflow scrolling: it runs on the compositor thread, which
// presents frames faster than React can swap + paint the windowed rows during
// a fast fling — the painted rows scroll out of view and the list flashes
// blank until the main thread catches up. No overscan is ever "enough"; the
// compositor can always outrun it. Owning the scroll on the main thread
// (overflow:hidden + translateY + custom scrollbar + non-passive wheel with
// flushSync) means a frame is only presented after its rows are committed, so
// a blank frame is impossible by construction.
//
// Markup contract (viewport must be position:relative / overflow:hidden):
//
//   <div ref={vs.viewportRef} className="…">
//     <div className="vlist__sizer" style={{ height: vs.totalHeight }} aria-hidden="true" />
//     <div className="vlist__content" style={{ transform: `translateY(${-vs.top}px)` }}>
//       …rows for [vs.start, vs.end), absolutely positioned at vs.rowTop(i)…
//     </div>
//     <VScrollbar vs={vs} />
//   </div>
//
// The viewport node is captured via a callback ref (not a plain ref): popover
// children mount a tick after `open` flips, so effects keyed on `open` would
// run while the ref is still null. Keying them on the node itself makes them
// run exactly when it mounts/unmounts.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

/** Minimum draggable scrollbar thumb height (px). */
const MIN_THUMB = 24

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

/** Thumb height for the given geometry; 0 when the list fits the viewport. */
const thumbHeight = (viewportH: number, totalHeight: number) =>
  totalHeight > viewportH ? Math.max(MIN_THUMB, (viewportH * viewportH) / totalHeight) : 0

export interface VirtualScrollOptions {
  /** Number of rows. */
  count: number
  /** Fixed row height (px). */
  rowHeight: number
  /** Extra rows rendered above/below the window — covers sub-pixel rounding.
   *  Main-thread scrolling never outruns the render, so this stays tiny. */
  overscan?: number
  /** Empty space above the first row / below the last one (px). */
  padTop?: number
  padBottom?: number
  /** Viewport height assumed until the first measurement lands (px). */
  initialViewportH?: number
}

export interface VirtualScroll {
  /** Callback ref for the viewport node (relative, overflow hidden). */
  viewportRef: (el: HTMLDivElement | null) => void
  /** The viewport node, for imperative focus(). */
  viewportEl: HTMLDivElement | null
  /** Measured viewport height (px). */
  viewportH: number
  /** Clamped scroll offset (px) — translate the content by -top. */
  top: number
  /** Full scrollable height (px) — the sizer's height. */
  totalHeight: number
  /** Rendered row window: [start, end). */
  start: number
  end: number
  /** Absolute y of a row inside the content (px). */
  rowTop: (index: number) => number
  scrollTo: (px: number) => void
  scrollBy: (px: number) => void
  /** Scroll the minimum amount that brings `index` fully on screen. */
  ensureVisible: (index: number) => void
  /** Scrollbar geometry: thumb height 0 means "no overflow, hide the bar". */
  thumbH: number
  thumbTop: number
  onThumbDown: (e: React.MouseEvent) => void
  onTrackDown: (e: React.MouseEvent) => void
}

export function useVirtualScroll({
  count,
  rowHeight,
  overscan = 4,
  padTop = 0,
  padBottom = 0,
  initialViewportH = 400
}: VirtualScrollOptions): VirtualScroll {
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null)
  const [viewportH, setViewportH] = useState(initialViewportH)
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = padTop + count * rowHeight + padBottom
  const maxScroll = Math.max(0, totalHeight - viewportH)
  // The state is left unclamped when the list shrinks; clamping the derived
  // value (and every write) keeps renders correct without an extra effect.
  const top = clamp(scrollTop, 0, maxScroll)

  // Fresh values for the once-per-mount wheel listener and stable callbacks.
  const live = useRef({ top, maxScroll, viewportH, rowHeight, padTop, totalHeight })
  live.current = { top, maxScroll, viewportH, rowHeight, padTop, totalHeight }

  // Measure the viewport, and keep it in sync on resize (sidebar drags etc.).
  useLayoutEffect(() => {
    if (!viewportEl) return
    const measure = () => setViewportH(viewportEl.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(viewportEl)
    return () => ro.disconnect()
  }, [viewportEl])

  // Wheel must be a non-passive listener so preventDefault lets us own the
  // scroll. flushSync commits the new window synchronously, before paint —
  // this is the line that makes blank frames impossible.
  useEffect(() => {
    if (!viewportEl) return
    const onWheel = (e: WheelEvent) => {
      const { maxScroll, viewportH, rowHeight } = live.current
      if (maxScroll <= 0) return
      e.preventDefault()
      // Normalize delta units: 0 = pixels (trackpads), 1 = lines (Windows
      // wheel mice), 2 = pages. Raw line deltas would crawl a few px per tick.
      const dy =
        e.deltaMode === 1
          ? e.deltaY * rowHeight
          : e.deltaMode === 2
            ? e.deltaY * viewportH
            : e.deltaY
      flushSync(() => setScrollTop((s) => clamp(s + dy, 0, maxScroll)))
    }
    viewportEl.addEventListener('wheel', onWheel, { passive: false })
    return () => viewportEl.removeEventListener('wheel', onWheel)
  }, [viewportEl])

  const scrollTo = useCallback((px: number) => {
    setScrollTop(clamp(px, 0, live.current.maxScroll))
  }, [])

  const scrollBy = useCallback((px: number) => {
    setScrollTop(clamp(live.current.top + px, 0, live.current.maxScroll))
  }, [])

  const ensureVisible = useCallback((index: number) => {
    const { top, viewportH, rowHeight, padTop } = live.current
    const rowT = padTop + index * rowHeight
    if (rowT < top) setScrollTop(clamp(rowT, 0, live.current.maxScroll))
    else if (rowT + rowHeight > top + viewportH)
      setScrollTop(clamp(rowT + rowHeight - viewportH, 0, live.current.maxScroll))
  }, [])

  const rowTop = useCallback((index: number) => live.current.padTop + index * rowHeight, [rowHeight])

  const start = Math.max(0, Math.floor((top - padTop) / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((top - padTop + viewportH) / rowHeight) + overscan)

  const thumbH = thumbHeight(viewportH, totalHeight)
  const thumbTop = maxScroll > 0 ? (top / maxScroll) * (viewportH - thumbH) : 0

  /** Drag from `startY` with the scroll at `fromTop`; shared by thumb + track. */
  const beginDrag = useCallback((startY: number, fromTop: number) => {
    const onMove = (ev: MouseEvent) => {
      const { maxScroll, viewportH, totalHeight } = live.current
      const range = viewportH - thumbHeight(viewportH, totalHeight)
      const next = range > 0 ? fromTop + ((ev.clientY - startY) / range) * maxScroll : 0
      flushSync(() => setScrollTop(clamp(next, 0, maxScroll)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const onThumbDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      beginDrag(e.clientY, live.current.top)
    },
    [beginDrag]
  )

  // Clicking the track jumps the thumb's centre to the cursor (the VS Code /
  // macOS "jump to spot" behaviour) and keeps dragging from there.
  const onTrackDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const { maxScroll, viewportH, totalHeight } = live.current
      if (maxScroll <= 0) return
      const bar = e.currentTarget.getBoundingClientRect()
      const tH = thumbHeight(viewportH, totalHeight)
      const range = Math.max(1, viewportH - tH)
      const next = clamp(((e.clientY - bar.top - tH / 2) / range) * maxScroll, 0, maxScroll)
      flushSync(() => setScrollTop(next))
      beginDrag(e.clientY, next)
    },
    [beginDrag]
  )

  return {
    viewportRef: setViewportEl,
    viewportEl,
    viewportH,
    top,
    totalHeight,
    start,
    end,
    rowTop,
    scrollTo,
    scrollBy,
    ensureVisible,
    thumbH,
    thumbTop,
    onThumbDown,
    onTrackDown
  }
}

/** Overlay scrollbar — renders nothing when the list fits the viewport. */
export function VScrollbar({ vs }: { vs: VirtualScroll }) {
  if (vs.thumbH <= 0) return null
  return (
    <div className="vlist__bar" onMouseDown={vs.onTrackDown}>
      <div
        className="vlist__thumb"
        style={{ height: vs.thumbH, transform: `translateY(${vs.thumbTop}px)` }}
        onMouseDown={vs.onThumbDown}
      />
    </div>
  )
}
