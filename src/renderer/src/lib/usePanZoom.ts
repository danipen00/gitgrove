// Shared pan/zoom state for the image viewer. One instance is owned by the
// viewer host and passed to whichever mode is active, so switching between
// onion skin / side-by-side / differences / swipe keeps the exact framing —
// you never lose the pixel you were inspecting.
//
// Interaction model (the muscle memory of every image tool):
//   wheel / two-finger scroll   pan
//   pinch, Ctrl/Cmd + wheel     zoom at the cursor
//   drag                        pan
//   double-click                toggle fit ⇄ 100% (animated, into the click)
//   +/− buttons, fit, 1:1       animated zoom
// Programmatic zooms glide via a CSS transition on the world transform;
// direct manipulation (wheel/pinch/drag) is always instant — animation under
// the finger reads as lag, not delight.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  centeredTransform,
  clampPan,
  clampZoom,
  fitZoom,
  type ViewTransform,
  ZOOM_STEP,
  zoomAroundPoint
} from './image-diff'

type Size = { width: number; height: number }

/** Elements over the stage whose pointer interactions must never pan/zoom:
 *  real controls, plus anything marked `data-no-pan` (the swipe handle). */
const NO_PAN_TARGETS = 'button, input, [data-no-pan]'

export interface PanZoom {
  /** Current transform; apply as `translate(x, y) scale(scale)`. */
  transform: ViewTransform
  /** True while a button/double-click zoom glides (drives the CSS transition). */
  animated: boolean
  /** True when the view is in "fit" mode (auto re-fits on pane resize). */
  fitted: boolean
  /**
   * Ref callback for every viewport element rendering the shared world
   * (side-by-side binds two). Wires wheel/pinch/drag/double-click and size
   * tracking; React 19 ref cleanups detach when the mode unmounts.
   */
  bindViewport: (el: HTMLElement | null) => undefined | (() => void)
  zoomIn: () => void
  zoomOut: () => void
  zoomToFit: () => void
  zoomToActualSize: () => void
}

/**
 * `imageSize` is the composed frame both revisions share (max of the two
 * natural sizes); null until the images decode. The view starts fitted —
 * never upscaled past 100% — exactly like the UVCS viewer.
 */
export function usePanZoom(imageSize: Size | null): PanZoom {
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const [animated, setAnimated] = useState(false)
  const [fitted, setFitted] = useState(true)

  // Bound viewport elements. Simultaneous viewports are layout twins (the
  // side-by-side halves), so any one of them measures the shared frame.
  const viewports = useRef(new Set<HTMLElement>())
  const frameRef = useRef<Size | null>(null)
  const imageRef = useRef(imageSize)
  imageRef.current = imageSize
  const transformRef = useRef(transform)
  transformRef.current = transform
  const fittedRef = useRef(fitted)
  fittedRef.current = fitted

  const applyFit = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return
    setTransform(centeredTransform(fitZoom(frame, image), frame, image))
  }, [])

  /** Re-clamp (or re-fit) after the frame or image changed shape. */
  const reconcile = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return
    setAnimated(false)
    if (fittedRef.current) applyFit()
    else setTransform((t) => clampPan(t, frame, image))
  }, [applyFit])

  // A new image landed (file selection changed): reset to a fitted view —
  // inheriting the previous file's deep zoom would show arbitrary pixels.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the image identity by design.
  useEffect(() => {
    setFitted(true)
    setAnimated(false)
    applyFit()
  }, [imageSize, applyFit])

  /** Instant zoom at a viewport point (wheel/pinch). */
  const zoomAt = useCallback((nextScale: number, anchor: { x: number; y: number }) => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return
    setAnimated(false)
    setFitted(false)
    setTransform((t) => zoomAroundPoint(t, nextScale, anchor, frame, image))
  }, [])

  /** Animated zoom to a scale, anchored at `anchor` (default: frame center). */
  const glideTo = useCallback(
    (nextScale: number, fit: boolean, anchor?: { x: number; y: number }) => {
      const frame = frameRef.current
      const image = imageRef.current
      if (!frame || !image) return
      setAnimated(true)
      setFitted(fit)
      const at = anchor ?? { x: frame.width / 2, y: frame.height / 2 }
      setTransform((t) => zoomAroundPoint(t, nextScale, at, frame, image))
    },
    []
  )

  const zoomIn = useCallback(
    () => glideTo(clampZoom(transformRef.current.scale * ZOOM_STEP), false),
    [glideTo]
  )
  const zoomOut = useCallback(
    () => glideTo(clampZoom(transformRef.current.scale / ZOOM_STEP), false),
    [glideTo]
  )
  const zoomToFit = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return
    glideTo(fitZoom(frame, image), true)
  }, [glideTo])
  const zoomToActualSize = useCallback(() => glideTo(1, false), [glideTo])

  // One observer for every bound viewport: fit mode follows pane resizes
  // (sidebar splitter drags, window resizes); free mode just re-clamps.
  const resizeObserver = useMemo(
    () =>
      new ResizeObserver((entries) => {
        const el = entries[0]?.target as HTMLElement | undefined
        if (!el || !viewports.current.has(el)) return
        frameRef.current = { width: el.clientWidth, height: el.clientHeight }
        reconcile()
      }),
    [reconcile]
  )
  useEffect(() => () => resizeObserver.disconnect(), [resizeObserver])

  const onPointerDown = useCallback((el: HTMLElement, e: PointerEvent) => {
    // Left or middle button (the image-tool convention: middle-drag pans);
    // leave controls layered over the stage alone. The check must happen
    // here, natively: this listener fires while the event bubbles to the
    // viewport, before any React synthetic handler — a control's
    // stopPropagation would arrive too late to stop the pan. `data-no-pan`
    // marks stage controls with their own drag (swipe divider).
    if ((e.button !== 0 && e.button !== 1) || (e.target as HTMLElement).closest(NO_PAN_TARGETS))
      return
    // Middle button: cancel the default so Chromium never starts its
    // autoscroll affordance over the stage.
    if (e.button === 1) e.preventDefault()
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return
    const start = { x: e.clientX, y: e.clientY }
    const origin = transformRef.current
    el.setPointerCapture(e.pointerId)
    setAnimated(false)
    const onMove = (ev: PointerEvent) => {
      setFitted(false)
      setTransform(
        clampPan(
          {
            scale: origin.scale,
            x: origin.x + (ev.clientX - start.x),
            y: origin.y + (ev.clientY - start.y)
          },
          frame,
          image
        )
      )
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }, [])

  const onDoubleClick = useCallback(
    (el: HTMLElement, e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(NO_PAN_TARGETS)) return
      const rect = el.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const frame = frameRef.current
      const image = imageRef.current
      if (!frame || !image) return
      // Below 100%: dive to actual size into the click; otherwise back to fit.
      if (transformRef.current.scale < 0.999) glideTo(1, false, anchor)
      else glideTo(fitZoom(frame, image), true)
    },
    [glideTo]
  )

  const bindViewport = useCallback(
    (el: HTMLElement | null): undefined | (() => void) => {
      if (!el) return
      viewports.current.add(el)
      frameRef.current = { width: el.clientWidth, height: el.clientHeight }
      resizeObserver.observe(el)
      reconcile()

      // Wheel must be a native non-passive listener: preventDefault has to
      // beat the page scroll and macOS back-swipe. Pinch = wheel + ctrlKey.
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const frame = frameRef.current
        const image = imageRef.current
        if (!frame || !image) return
        if (e.ctrlKey || e.metaKey) {
          const rect = el.getBoundingClientRect()
          // Exponential mapping keeps pinch speed proportional at any zoom.
          // Trackpad pinches stream many small deltas; a mouse wheel fires
          // one big notch (±100ish pixels, or line-mode deltas) that would
          // jump several zoom levels at once. Clamping the per-event delta
          // caps a notch at a gentle ~1.2× step while leaving the small
          // pinch deltas untouched.
          const raw = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * 16
          const delta = Math.max(-16, Math.min(16, raw))
          zoomAt(transformRef.current.scale * Math.exp(-delta * 0.012), {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
          })
        } else {
          setAnimated(false)
          setFitted(false)
          setTransform((t) =>
            clampPan({ scale: t.scale, x: t.x - e.deltaX, y: t.y - e.deltaY }, frame, image)
          )
        }
      }
      const onDown = (e: PointerEvent) => onPointerDown(el, e)
      const onDbl = (e: MouseEvent) => onDoubleClick(el, e)
      el.addEventListener('wheel', onWheel, { passive: false })
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('dblclick', onDbl)
      return () => {
        viewports.current.delete(el)
        resizeObserver.unobserve(el)
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('dblclick', onDbl)
        // The surviving viewport (mode switch) re-measures the frame.
        const next = viewports.current.values().next().value
        if (next) {
          frameRef.current = { width: next.clientWidth, height: next.clientHeight }
          reconcile()
        }
      }
    },
    [resizeObserver, reconcile, zoomAt, onPointerDown, onDoubleClick]
  )

  return useMemo(
    () => ({
      transform,
      animated,
      fitted,
      bindViewport,
      zoomIn,
      zoomOut,
      zoomToFit,
      zoomToActualSize
    }),
    [transform, animated, fitted, bindViewport, zoomIn, zoomOut, zoomToFit, zoomToActualSize]
  )
}
