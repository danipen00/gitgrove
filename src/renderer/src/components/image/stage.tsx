// Building blocks every image-diff mode composes: a Viewport (the pan/zoom
// event surface), a World (the transformed composed frame both revisions
// share) and a CenteredImage (one revision, centered in that frame — resized
// assets stay visually anchored, the UVCS convention). Keeping these tiny and
// shared is what lets all four modes feel like one viewer: same checkerboard,
// same transform, same physics.

import type { ReactNode } from 'react'
import { centeredOffset } from '@/lib/image-diff'
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
 */
export function World({ panZoom, frame, children }: WorldProps) {
  const { transform, animated } = panZoom
  return (
    <div
      className={`img-world${animated ? ' img-world--gliding' : ''}`}
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
  )
}

interface CenteredImageProps {
  image: DecodedImage
  frame: { width: number; height: number }
  /** Tints the revision border: old reads red, new reads green. */
  side: 'old' | 'new'
  /** 0–1 opacity for the onion-skin blend. */
  opacity?: number
}

/** One revision, centered in the composed frame at its natural pixel size. */
export function CenteredImage({ image, frame, side, opacity }: CenteredImageProps) {
  const off = centeredOffset(frame, image)
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
