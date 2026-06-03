import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  /** Preferred horizontal alignment relative to the anchor. */
  align?: 'left' | 'right'
  width?: number
  children: ReactNode
}

/**
 * A lightweight floating panel anchored to a trigger element. Closes on outside
 * click and Escape. Positioned with fixed coordinates derived from the anchor's
 * bounding rect, kept within the viewport.
 */
export function Popover({ anchor, open, onClose, align = 'left', width, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const r = anchor.getBoundingClientRect()
    const w = width ?? Math.max(r.width, 240)
    const margin = 8
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin))
    const top = Math.min(r.bottom + 6, window.innerHeight - margin)
    setPos({ top, left, minWidth: w })
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !pos) return null

  return createPortal(
    <>
      <div className="popover-backdrop" onMouseDown={onClose} />
      <div
        ref={ref}
        className="popover"
        style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
        role="dialog"
      >
        {children}
      </div>
    </>,
    document.body
  )
}
