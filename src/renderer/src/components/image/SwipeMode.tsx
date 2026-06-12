// Swipe: both revisions stacked, with a draggable divider revealing old on
// the left and new on the right. The new layer is clipped at the divider in
// viewport space, so the split line stays put while the image pans and zooms
// underneath it — exactly how a film wipe behaves.

import { useCallback, useRef, useState } from 'react'
import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { CenteredImage, Viewport, World } from './stage'

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
}

export function SwipeMode({ oldImage, newImage, frame, panZoom }: Props) {
  /** Divider position as a fraction of the viewport width. */
  const [split, setSplit] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)

  const onHandleDown = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current
    if (!el) return
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      setSplit(Math.min(0.98, Math.max(0.02, (ev.clientX - rect.left) / rect.width)))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }, [])

  return (
    <div className="img-swipe" ref={containerRef}>
      <Viewport panZoom={panZoom}>
        <World panZoom={panZoom} frame={frame}>
          <CenteredImage image={oldImage} frame={frame} side="old" />
        </World>
        {/* The new revision rides the same transform inside a viewport-level
            clip, so only the divider decides how much of it shows. */}
        <div className="img-swipe__reveal" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>
          <World panZoom={panZoom} frame={frame}>
            <CenteredImage image={newImage} frame={frame} side="new" />
          </World>
        </div>
        <div className="img-swipe__divider" style={{ left: `${split * 100}%` }}>
          {/* data-no-pan: the viewport's native pan listener fires before any
              React handler here could stopPropagation — the stage checks the
              attribute instead (see usePanZoom NO_PAN_TARGETS). */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag handle, keyboard-reachable via the stage shortcuts */}
          <div className="img-swipe__handle" data-no-pan onPointerDown={onHandleDown}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3.5 1 0.5 5l3 4M6.5 1l3 4-3 4" fill="none" stroke="currentColor" />
            </svg>
          </div>
        </div>
        <span className="img-side-chip img-side-chip--old">Old</span>
        <span className="img-side-chip img-side-chip--new img-side-chip--right">New</span>
      </Viewport>
    </div>
  )
}
