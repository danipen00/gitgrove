import { describe, expect, test } from 'bun:test'
import {
  centeredOffset,
  clampPan,
  clampZoom,
  composedSize,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  pixelDiff,
  type RgbaBitmap,
  zoomAroundPoint,
  zoomLabel
} from './image-diff'

/** Build a bitmap from per-pixel RGBA tuples (row-major). */
function bitmap(width: number, height: number, pixels: number[][]): RgbaBitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  pixels.forEach((px, i) => data.set(px, i * 4))
  return { data, width, height }
}

/** Read pixel (x, y) of a bitmap as an RGBA tuple. */
function px(b: RgbaBitmap, x: number, y: number): number[] {
  const i = (y * b.width + x) * 4
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]]
}

const opaque = (r: number, g: number, b: number) => [r, g, b, 255]

describe('composedSize / centeredOffset', () => {
  test('composed frame is the max of both sizes', () => {
    expect(composedSize({ width: 4, height: 10 }, { width: 6, height: 2 })).toEqual({
      width: 6,
      height: 10
    })
  })

  test('centers and floors to whole pixels', () => {
    expect(centeredOffset({ width: 10, height: 10 }, { width: 4, height: 4 })).toEqual({
      x: 3,
      y: 3
    })
    expect(centeredOffset({ width: 5, height: 5 }, { width: 2, height: 2 })).toEqual({ x: 1, y: 1 })
  })
})

describe('pixelDiff', () => {
  test('identical pixels compose to white and count zero changes', () => {
    const a = bitmap(2, 1, [opaque(10, 20, 30), opaque(200, 100, 50)])
    const b = bitmap(2, 1, [opaque(10, 20, 30), opaque(200, 100, 50)])
    const { diff, changedPixels, coveredPixels } = pixelDiff(a, b)
    // ~(x ^ x) = 0xff per channel; equal alpha keeps 255.
    expect(px(diff, 0, 0)).toEqual([255, 255, 255, 255])
    expect(px(diff, 1, 0)).toEqual([255, 255, 255, 255])
    expect(changedPixels).toBe(0)
    expect(coveredPixels).toBe(2)
  })

  test('differing channels invert the xor (the UVCS algorithm)', () => {
    const a = bitmap(1, 1, [opaque(0b1111_0000, 0, 0)])
    const b = bitmap(1, 1, [opaque(0b0000_1111, 0, 0)])
    const { diff, changedPixels } = pixelDiff(a, b)
    // r: ~(0xf0 ^ 0x0f) = ~0xff = 0x00; g/b identical → 0xff.
    expect(px(diff, 0, 0)).toEqual([0, 255, 255, 255])
    expect(changedPixels).toBe(1)
  })

  test('alpha difference dims the result alpha by half the delta', () => {
    const a = bitmap(1, 1, [[50, 50, 50, 255]])
    const b = bitmap(1, 1, [[50, 50, 50, 55]])
    const { diff, changedPixels } = pixelDiff(a, b)
    expect(px(diff, 0, 0)[3]).toBe(255 - 100)
    expect(changedPixels).toBe(1)
  })

  test('pixels fully transparent on both sides stay transparent and unchanged', () => {
    const a = bitmap(1, 1, [[10, 20, 30, 0]])
    const b = bitmap(1, 1, [[90, 80, 70, 0]])
    const { diff, changedPixels } = pixelDiff(a, b)
    expect(px(diff, 0, 0)).toEqual([0, 0, 0, 0])
    expect(changedPixels).toBe(0)
  })

  test('different sizes: images center, non-overlap shows the lone side and counts as changed', () => {
    // 1×1 red inside a 3×1 frame vs 3×1 of the same red: the middle pixel
    // overlaps (identical → white), the flanks exist only on the right image.
    const small = bitmap(1, 1, [opaque(255, 0, 0)])
    const wide = bitmap(3, 1, [opaque(255, 0, 0), opaque(255, 0, 0), opaque(255, 0, 0)])
    const { diff, changedPixels, coveredPixels } = pixelDiff(small, wide)
    expect(diff.width).toBe(3)
    expect(diff.height).toBe(1)
    expect(px(diff, 0, 0)).toEqual([255, 0, 0, 255]) // right image only
    expect(px(diff, 1, 0)).toEqual([255, 255, 255, 255]) // identical overlap
    expect(px(diff, 2, 0)).toEqual([255, 0, 0, 255]) // right image only
    expect(coveredPixels).toBe(3) // union of both rects
    expect(changedPixels).toBe(2) // the two single-coverage flanks
  })

  test('disjoint-axis sizes keep both images visible in the composed frame', () => {
    // 2×1 vs 1×2 → 2×2 frame. Both center to offset (0,0) — the case where
    // the reference's offset comparison would skip painting; size-keyed
    // layering still paints the single-coverage cells.
    const horizontal = bitmap(2, 1, [opaque(1, 2, 3), opaque(4, 5, 6)])
    const vertical = bitmap(1, 2, [opaque(1, 2, 3), opaque(9, 9, 9)])
    const { diff, changedPixels, coveredPixels } = pixelDiff(horizontal, vertical)
    expect(diff.width).toBe(2)
    expect(diff.height).toBe(2)
    expect(px(diff, 0, 0)).toEqual([255, 255, 255, 255]) // overlap, identical
    expect(px(diff, 1, 0)).toEqual([4, 5, 6, 255]) // horizontal-only cell
    expect(px(diff, 0, 1)).toEqual([9, 9, 9, 255]) // vertical-only cell
    expect(px(diff, 1, 1)).toEqual([0, 0, 0, 0]) // covered by neither
    expect(coveredPixels).toBe(3) // 2 + 2 − 1 overlapping cell
    expect(changedPixels).toBe(2)
  })
})

describe('zoom math', () => {
  const frame = { width: 800, height: 600 }

  test('clampZoom respects the bounds', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(1e9)).toBe(MAX_ZOOM)
    expect(clampZoom(2)).toBe(2)
  })

  test('fitZoom fits large images with a margin and never upscales small ones', () => {
    // 8000×600 in 800×600 with 24px margins: width-bound → (800−48)/8000.
    expect(fitZoom(frame, { width: 8000, height: 600 })).toBeCloseTo(752 / 8000, 6)
    // A 16×16 icon must stay at 100%, not blow up to fill the pane.
    expect(fitZoom(frame, { width: 16, height: 16 })).toBe(1)
    expect(fitZoom(frame, { width: 0, height: 0 })).toBe(1)
  })

  test('clampPan centers axes that fit and clamps axes that overflow', () => {
    const image = { width: 100, height: 2000 }
    const t = clampPan({ scale: 1, x: -500, y: -5000 }, frame, image)
    expect(t.x).toBe((frame.width - 100) / 2) // fits → centered
    expect(t.y).toBe(frame.height - 2000) // overflows → clamped to bottom edge
    const t2 = clampPan({ scale: 1, x: 0, y: 99 }, frame, image)
    expect(t2.y).toBe(0) // can't pan past the top edge either
  })

  test('zoomAroundPoint keeps the image point under the anchor fixed', () => {
    const image = { width: 4000, height: 4000 }
    const t = { scale: 1, x: -100, y: -200 }
    const anchor = { x: 400, y: 300 }
    const next = zoomAroundPoint(t, 2, anchor, frame, image)
    // The image-space point at the anchor before…
    const beforeX = (anchor.x - t.x) / t.scale
    const beforeY = (anchor.y - t.y) / t.scale
    // …must sit at the anchor after.
    expect(next.x + beforeX * next.scale).toBeCloseTo(anchor.x, 6)
    expect(next.y + beforeY * next.scale).toBeCloseTo(anchor.y, 6)
  })

  test('zoomLabel formats round and tiny percentages', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(0.333)).toBe('33%')
    expect(zoomLabel(0.063)).toBe('6.3%')
    expect(zoomLabel(16)).toBe('1600%')
  })
})
