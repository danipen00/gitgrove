import { useCallback, useRef, useState } from 'react'

interface Props {
  orientation: 'x' | 'y'
  /**
   * Direction of growth. By default a positive pointer delta (drag right/down)
   * grows the size — correct when the resized panel sits before the splitter.
   * Set `invert` when the panel sits after it (e.g. a bottom panel).
   */
  invert?: boolean
  /** Current committed size in px; used as the baseline when a drag starts. */
  size: number
  min: number
  max: number
  /**
   * Fired (at most once per animation frame) while dragging with the new size.
   * Apply it to the DOM imperatively so the drag never triggers a React state
   * update / re-render of the surrounding layout.
   */
  onPreview: (size: number) => void
  /** Fired once on release with the final size — commit it to state here. */
  onCommit: (size: number) => void
}

export function Resizer({ orientation, invert, size, min, max, onPreview, onCommit }: Props) {
  const [dragging, setDragging] = useState(false)
  const start = useRef(0)
  const startSize = useRef(size)
  const latest = useRef(size)
  const raf = useRef<number | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      start.current = orientation === 'x' ? e.clientX : e.clientY
      startSize.current = size
      latest.current = size
      setDragging(true)
    },
    [orientation, size]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const cur = orientation === 'x' ? e.clientX : e.clientY
      const delta = (cur - start.current) * (invert ? -1 : 1)
      latest.current = Math.min(max, Math.max(min, startSize.current + delta))
      // Coalesce moves to one update per frame; the actual write happens in App.
      if (raf.current == null) {
        raf.current = requestAnimationFrame(() => {
          raf.current = null
          onPreview(latest.current)
        })
      }
    },
    [dragging, orientation, invert, min, max, onPreview]
  )

  const stop = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      if (raf.current != null) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
      setDragging(false)
      onCommit(latest.current)
    },
    [onCommit]
  )

  return (
    <div
      className={`resizer-${orientation}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      role="separator"
      aria-orientation={orientation === 'x' ? 'vertical' : 'horizontal'}
    />
  )
}
