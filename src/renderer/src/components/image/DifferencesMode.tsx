// Differences: a composed image where every channel is ~(old XOR new) — the
// UVCS algorithm. Identical pixels render white; any difference explodes into
// color, which makes one-pixel drifts impossible to miss. The composition
// runs once per image pair (cached by the viewer) and is reported up so the
// HUD can show "n% of pixels differ".

import { useEffect, useRef, useState } from 'react'
import { pixelDiff, type RgbaBitmap } from '@/lib/image-diff'
import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { useSpinDelay } from '@/lib/useSpinDelay'
import { Viewport, World } from './stage'

export interface DiffStats {
  changedPixels: number
  coveredPixels: number
}

/** A computed difference image, cached by the viewer across mode switches. */
export interface DiffComposition {
  oldSrc: string
  newSrc: string
  imageData: ImageData
  stats: DiffStats
}

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
  /** Single-entry cache owned by the viewer (survives mode round-trips). */
  cache: { current: DiffComposition | null }
  onStats: (stats: DiffStats) => void
}

/** Rasterize a decoded image (SVG included) into a tightly packed bitmap. */
function rasterize(image: DecodedImage): RgbaBitmap {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { data: new Uint8ClampedArray(image.width * image.height * 4), ...size(image) }
  ctx.drawImage(image.el, 0, 0, image.width, image.height)
  const data = ctx.getImageData(0, 0, image.width, image.height)
  return { data: data.data, width: data.width, height: data.height }
}

const size = (i: { width: number; height: number }) => ({ width: i.width, height: i.height })

function compose(oldImage: DecodedImage, newImage: DecodedImage): DiffComposition {
  const { diff, changedPixels, coveredPixels } = pixelDiff(rasterize(oldImage), rasterize(newImage))
  return {
    oldSrc: oldImage.src,
    newSrc: newImage.src,
    imageData: new ImageData(diff.data, diff.width, diff.height),
    stats: { changedPixels, coveredPixels }
  }
}

export function DifferencesMode({ oldImage, newImage, frame, panZoom, cache, onStats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [computing, setComputing] = useState(false)
  // Spinner only for genuinely slow compositions (multi-megapixel pairs) —
  // small images compose in a frame or two and must not flash.
  const spin = useSpinDelay(computing)

  useEffect(() => {
    let stale = false
    const cached = cache.current
    const hit =
      cached && cached.oldSrc === oldImage.src && cached.newSrc === newImage.src ? cached : null
    const apply = (composition: DiffComposition) => {
      if (stale) return
      cache.current = composition
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = composition.imageData.width
        canvas.height = composition.imageData.height
        canvas.getContext('2d')?.putImageData(composition.imageData, 0, 0)
      }
      onStats(composition.stats)
      setComputing(false)
    }
    if (hit) {
      apply(hit)
      return
    }
    setComputing(true)
    // Yield a frame so the mode switch paints before the pixel pass runs —
    // the work is synchronous but the UI never appears to hang.
    const id = requestAnimationFrame(() => apply(compose(oldImage, newImage)))
    return () => {
      stale = true
      cancelAnimationFrame(id)
    }
  }, [oldImage, newImage, cache, onStats])

  return (
    <Viewport panZoom={panZoom}>
      <World panZoom={panZoom} frame={frame}>
        <canvas ref={canvasRef} className="img-diff-canvas" />
      </World>
      {spin && (
        <div className="img-computing">
          <div className="spinner spinner--sm" /> Comparing pixels…
        </div>
      )}
    </Viewport>
  )
}
