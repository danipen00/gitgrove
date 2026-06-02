import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Tip {
  text: string
  /** Pointer position at show time — the tip is anchored to the cursor. */
  pointerX: number
  pointerY: number
}

const SHOW_DELAY = 120

/**
 * A single delegated tooltip for the whole app. Any element carrying a `data-tip`
 * attribute shows it on hover — rendered in a portal so the truncation
 * `overflow: hidden` ancestors can't clip it. Add `data-tip-overflow` to only
 * show the tip when the element's text is actually truncated.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const clear = () => {
      clearTimeout(timer.current)
    }
    const hide = () => {
      clear()
      setTip(null)
      setCoords(null)
    }
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const el = target?.closest?.('[data-tip]') as HTMLElement | null
      if (!el) {
        hide()
        return
      }
      const text = el.getAttribute('data-tip')
      if (!text) return hide()
      // Skip when the label isn't actually clipped.
      if (el.hasAttribute('data-tip-overflow') && el.scrollWidth <= el.clientWidth + 1) {
        return hide()
      }
      clear()
      timer.current = setTimeout(
        () => setTip({ text, pointerX: pointer.current.x, pointerY: pointer.current.y }),
        SHOW_DELAY
      )
    }
    const onOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-tip]')) hide()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clear()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Standard cursor-tooltip placement: top-left just below-right of the pointer.
  // Horizontally it shifts left to stay on screen (keeping it under the cursor);
  // vertically it flips above the cursor only when there's no room below. A final
  // clamp guarantees it can never be cut off at a screen edge.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return
    const t = tipRef.current.getBoundingClientRect()
    const m = 8 // viewport margin
    const offX = 12
    const offY = 18 // clears the cursor glyph
    const { pointerX, pointerY } = tip
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Shift (not flip) horizontally so the tip stays beside the cursor.
    const left = Math.max(m, Math.min(pointerX + offX, vw - t.width - m))

    // Prefer below the cursor; flip above if it wouldn't fit below.
    let top = pointerY + offY
    if (top + t.height > vh - m) top = pointerY - offY - t.height
    top = Math.max(m, Math.min(top, vh - t.height - m))

    setCoords({ top, left })
  }, [tip])

  if (!tip) return null

  return createPortal(
    <div
      ref={tipRef}
      className="tooltip"
      role="tooltip"
      style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
