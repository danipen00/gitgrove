import { useCallback, useRef, useState } from 'react'

interface Props {
  orientation: 'x' | 'y'
  /** Called with the pixel delta along the axis as the user drags. */
  onResize: (delta: number) => void
}

export function Resizer({ orientation, onResize }: Props) {
  const [dragging, setDragging] = useState(false)
  const last = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      last.current = orientation === 'x' ? e.clientX : e.clientY
      setDragging(true)
    },
    [orientation]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const cur = orientation === 'x' ? e.clientX : e.clientY
      const delta = cur - last.current
      if (delta !== 0) {
        last.current = cur
        onResize(delta)
      }
    },
    [dragging, orientation, onResize]
  )

  const stop = useCallback((e: React.PointerEvent) => {
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }, [])

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
