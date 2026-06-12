// Pure logic for the image diff viewer: pixel-difference compositing and the
// pan/zoom geometry. No DOM here — everything operates on plain numbers and
// RGBA byte arrays so it can be unit-tested without a canvas.

/** A decoded RGBA bitmap: tightly packed rows (stride = width * 4). The
 *  buffer is pinned to plain ArrayBuffer so it can feed `new ImageData()`. */
export interface RgbaBitmap {
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

/**
 * The composed frame two differently-sized revisions are compared in: each
 * image is centered inside the max of both sizes (the Unity UVCS convention —
 * resized assets stay visually anchored instead of snapping to a corner).
 */
export function composedSize(
  a: { width: number; height: number },
  b: { width: number; height: number }
): { width: number; height: number } {
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) }
}

/** Top-left offset that centers `size` inside `frame` (floored to a pixel). */
export function centeredOffset(
  frame: { width: number; height: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: Math.floor((frame.width - size.width) / 2),
    y: Math.floor((frame.height - size.height) / 2)
  }
}

export interface PixelDiffResult {
  /** The composed difference bitmap (size = composedSize(old, new)). */
  diff: RgbaBitmap
  /** Pixels that differ (including pixels covered by only one image). */
  changedPixels: number
  /** Pixels covered by at least one image (the denominator for a % readout). */
  coveredPixels: number
}

/**
 * Compose the visual difference of two bitmaps, port of UVCS's
 * ImagePixelDiff: each image is centered in the composed frame; where both
 * overlap, every channel becomes the bitwise NOT of the XOR of the sides —
 * identical bytes render white, so differences scream in color — and alpha
 * becomes 255 − |Δalpha|/2 so the result stays visible. Pixels both sides
 * leave fully transparent stay transparent; regions covered by only one image
 * show that image's pixels (and count as changed).
 */
export function pixelDiff(left: RgbaBitmap, right: RgbaBitmap): PixelDiffResult {
  const frame = composedSize(left, right)
  const out: RgbaBitmap = {
    data: new Uint8ClampedArray(frame.width * frame.height * 4),
    width: frame.width,
    height: frame.height
  }
  const lOff = centeredOffset(frame, left)
  const rOff = centeredOffset(frame, right)

  // Different sizes: paint each image first, then overwrite the intersection
  // with the diff — the reference implementation's layering. (Keyed on the
  // sizes, not the offsets like UVCS does: a 2×1 vs 1×2 pair floors to the
  // same offset yet still has single-coverage pixels that must be painted.)
  if (left.width !== right.width || left.height !== right.height) {
    blit(left, out, lOff.x, lOff.y)
    blit(right, out, rOff.x, rOff.y)
  }

  const interLeft = Math.max(lOff.x, rOff.x)
  const interTop = Math.max(lOff.y, rOff.y)
  const interRight = Math.min(lOff.x + left.width, rOff.x + right.width)
  const interBottom = Math.min(lOff.y + left.height, rOff.y + right.height)

  const leftArea = left.width * left.height
  const rightArea = right.width * right.height
  const interArea =
    interRight > interLeft && interBottom > interTop
      ? (interRight - interLeft) * (interBottom - interTop)
      : 0
  const coveredPixels = leftArea + rightArea - interArea
  // Everything covered by exactly one image is by definition a change.
  let changedPixels = coveredPixels - interArea

  if (interArea === 0) return { diff: out, changedPixels, coveredPixels }

  for (let y = interTop; y < interBottom; y++) {
    let li = ((y - lOff.y) * left.width + (interLeft - lOff.x)) * 4
    let ri = ((y - rOff.y) * right.width + (interLeft - rOff.x)) * 4
    let oi = (y * frame.width + interLeft) * 4
    for (let x = interLeft; x < interRight; x++) {
      const la = left.data[li + 3]
      const ra = right.data[ri + 3]
      if (la === 0 && ra === 0) {
        // Both fully transparent: nothing to compare, leave transparent.
        out.data[oi] = 0
        out.data[oi + 1] = 0
        out.data[oi + 2] = 0
        out.data[oi + 3] = 0
      } else {
        const r = ~(left.data[li] ^ right.data[ri]) & 0xff
        const g = ~(left.data[li + 1] ^ right.data[ri + 1]) & 0xff
        const b = ~(left.data[li + 2] ^ right.data[ri + 2]) & 0xff
        out.data[oi] = r
        out.data[oi + 1] = g
        out.data[oi + 2] = b
        out.data[oi + 3] = 255 - ((Math.abs(la - ra) / 2) | 0)
        if (r !== 255 || g !== 255 || b !== 255 || la !== ra) changedPixels++
      }
      li += 4
      ri += 4
      oi += 4
    }
  }
  return { diff: out, changedPixels, coveredPixels }
}

/** Copy `src` into `dst` at (dx, dy). Bounds are guaranteed by the caller. */
function blit(src: RgbaBitmap, dst: RgbaBitmap, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const srcRow = y * src.width * 4
    const dstRow = ((y + dy) * dst.width + dx) * 4
    dst.data.set(src.data.subarray(srcRow, srcRow + src.width * 4), dstRow)
  }
}

// ── Pan/zoom geometry ────────────────────────────────────────────────────────

/** Zoom bounds: deep enough for pixel forensics, shallow enough to find tiny
 *  thumbnails again. */
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 64

/** Multiplier for the zoom in/out buttons and keyboard shortcuts. */
export const ZOOM_STEP = 1.5

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/**
 * The scale that fits `image` inside `frame` with a small breathing margin,
 * never upscaling past 100% — a 16×16 icon blown up to fill the pane reads as
 * a bug, not a fit.
 */
export function fitZoom(
  frame: { width: number; height: number },
  image: { width: number; height: number },
  margin = 24
): number {
  if (image.width <= 0 || image.height <= 0) return 1
  const availW = Math.max(frame.width - margin * 2, 1)
  const availH = Math.max(frame.height - margin * 2, 1)
  return clampZoom(Math.min(availW / image.width, availH / image.height, 1))
}

export interface ViewTransform {
  scale: number
  /** Translation of the image's top-left corner, in viewport pixels. */
  x: number
  y: number
}

/**
 * Clamp a pan so the image can never be lost: axes where the scaled image
 * fits inside the viewport stay centered; larger axes can pan exactly to
 * their edges and no further.
 */
export function clampPan(
  t: ViewTransform,
  frame: { width: number; height: number },
  image: { width: number; height: number }
): ViewTransform {
  const w = image.width * t.scale
  const h = image.height * t.scale
  const x = w <= frame.width ? (frame.width - w) / 2 : Math.min(0, Math.max(frame.width - w, t.x))
  const y =
    h <= frame.height ? (frame.height - h) / 2 : Math.min(0, Math.max(frame.height - h, t.y))
  return { scale: t.scale, x, y }
}

/** The transform that shows the image at `scale`, centered in the viewport. */
export function centeredTransform(
  scale: number,
  frame: { width: number; height: number },
  image: { width: number; height: number }
): ViewTransform {
  return {
    scale,
    x: (frame.width - image.width * scale) / 2,
    y: (frame.height - image.height * scale) / 2
  }
}

/**
 * Rescale around a viewport anchor point (the cursor): the image pixel under
 * the anchor stays under it, which is what makes wheel/pinch zoom feel
 * physical instead of teleporting.
 */
export function zoomAroundPoint(
  t: ViewTransform,
  nextScale: number,
  anchor: { x: number; y: number },
  frame: { width: number; height: number },
  image: { width: number; height: number }
): ViewTransform {
  const scale = clampZoom(nextScale)
  const ratio = scale / t.scale
  return clampPan(
    { scale, x: anchor.x - (anchor.x - t.x) * ratio, y: anchor.y - (anchor.y - t.y) * ratio },
    frame,
    image
  )
}

/** Human zoom label: 100%, 33%, 6.3%, 1600%. */
export function zoomLabel(scale: number): string {
  const pct = scale * 100
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`
}
