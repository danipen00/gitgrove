// Building blocks every image-diff mode composes: a Viewport (the pan/zoom
// event surface), a World (the transformed composed frame both revisions
// share) and an ImageLayer (one revision, placed in that frame by the active
// anchor — centered by default, the UVCS convention; top-left for canvas-grow
// comparisons). Keeping these tiny and shared is what lets all four modes
// feel like one viewer: same checkerboard, same transform, same physics.

import type { ReactNode } from 'react'
import { type AnchorMode, anchoredOffset } from '@/lib/image-diff'
import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'

interface ViewportProps {
  panZoom: PanZoom
  children: ReactNode
  /** Extra class for mode-specific chrome (e.g. side-by-side halves). */
  className?: string
}

/** The pan/zoom surface. Everything inside moves with the shared transform. */
export function Viewport({ panZoom, children, className }: ViewportProps) {
  return (
    <div className={`img-viewport${className ? ` ${className}` : ''}`} ref={panZoom.bindViewport}>
      {children}
    </div>
  )
}

interface WorldProps {
  panZoom: PanZoom
  frame: { width: number; height: number }
  children: ReactNode
}

/**
 * The composed frame, placed by the shared transform. Scaling happens here
 * (one GPU-composited transform), so layers inside are laid out once in image
 * pixels and never reflow while zooming.
 *
 * The transparency checkerboard is an untransformed twin underneath: it
 * covers exactly the world's screen rect but paints constant 16px screen
 * tiles. Counter-scaling a background on the transformed element reads
 * simpler, but Chromium rasterizes the repeating gradient at layout
 * resolution — at deep zoom the fractional sub-pixel tiles alias away, and
 * the repeating conic visibly loses contrast with distance from its origin.
 * Screen-space tiles can't break at any zoom, and since the twin rides the
 * same translation the pattern still pans with the image.
 */
export function World({ panZoom, frame, children }: WorldProps) {
  const { transform, animated } = panZoom
  const gliding = (name: string) => `${name}${animated ? ` ${name}--gliding` : ''}`
  return (
    <>
      <div
        className={gliding('img-checkerboard')}
        style={{
          left: transform.x,
          top: transform.y,
          width: frame.width * transform.scale,
          height: frame.height * transform.scale
        }}
      />
      <div
        className={gliding('img-world')}
        // Pixelated upscaling from ~4× so pixel-peeping shows crisp texels
        // instead of smear; below that, smooth interpolation looks right.
        data-pixelated={transform.scale >= 4 || undefined}
        style={{
          width: frame.width,
          height: frame.height,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        }}
      >
        {children}
      </div>
    </>
  )
}

interface ImageLayerProps {
  image: DecodedImage
  frame: { width: number; height: number }
  /** Tints the revision border: old reads red, new reads green. */
  side: 'old' | 'new'
  /** How the revision is placed in the composed frame (only matters when the
   *  revisions differ in size). Defaults to centered. */
  anchor?: AnchorMode
  /** 0–1 opacity for the onion-skin blend and the blink flip. */
  opacity?: number
}

/** One revision, placed in the composed frame at its natural pixel size. */
export function ImageLayer({ image, frame, side, anchor = 'center', opacity }: ImageLayerProps) {
  const off = anchoredOffset(frame, image, anchor)
  return (
    <img
      className={`img-layer img-layer--${side}`}
      src={image.src}
      alt=""
      draggable={false}
      style={{
        left: off.x,
        top: off.y,
        width: image.width,
        height: image.height,
        opacity
      }}
    />
  )
}
