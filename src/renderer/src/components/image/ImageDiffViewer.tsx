// The image pane: a single preview for added/deleted images, and a four-mode
// visual diff (onion skin / side by side / differences / swipe) for modified
// ones. One shared pan/zoom drives every mode, so switching modes keeps the
// framing; zoom controls float over the stage; an HUD strip narrates the
// change (dimensions, sizes, % of pixels that differ).

import type { ImageDiffSides } from '@shared/types'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '@/lib/format'
import { Icon } from '@/lib/icons'
import { composedSize, zoomLabel } from '@/lib/image-diff'
import { usePersistentState } from '@/lib/persist'
import { type DecodedImage, useDecodedImage } from '@/lib/useDecodedImage'
import { usePanZoom } from '@/lib/usePanZoom'
import { type DiffComposition, DifferencesMode, type DiffStats } from './DifferencesMode'
import { OnionSkinMode } from './OnionSkinMode'
import { SideBySideMode } from './SideBySideMode'
import { CenteredImage, Viewport, World } from './stage'
import { SwipeMode } from './SwipeMode'

export type ImageDiffMode = 'onion' | 'side-by-side' | 'differences' | 'swipe'

interface ModeDef {
  id: ImageDiffMode
  label: string
  icon: (size: number) => ReactNode
}

const MODES: ModeDef[] = [
  { id: 'onion', label: 'Onion skin', icon: (s) => <Icon.Layers size={s} /> },
  { id: 'side-by-side', label: 'Side by side', icon: (s) => <Icon.Split size={s} /> },
  { id: 'differences', label: 'Differences', icon: (s) => <Icon.Compare size={s} /> },
  { id: 'swipe', label: 'Swipe', icon: (s) => <Icon.Swipe size={s} /> }
]

interface Props {
  image: ImageDiffSides
}

/** "1024×768 · 245 KB" — one revision's identity card for the HUD. */
function sideLabel(image: DecodedImage, bytes: number): string {
  return `${image.width}×${image.height} · ${formatBytes(bytes)}`
}

export function ImageDiffViewer({ image }: Props) {
  const oldState = useDecodedImage(image.old?.dataUrl)
  const newState = useDecodedImage(image.new?.dataUrl)
  const [mode, setMode] = usePersistentState<ImageDiffMode>('gg.imageDiffMode', 'side-by-side')
  // Onion blend lives here (not in the mode) so a trip through other modes
  // comes back to the same mix. Reset per file via the image-keyed effect.
  const [blend, setBlend] = useState(0.5)
  const [stats, setStats] = useState<DiffStats | null>(null)
  const diffCache = useRef<DiffComposition | null>(null)

  const oldImage = oldState.status === 'ready' ? oldState.image : null
  const newImage = newState.status === 'ready' ? newState.image : null
  const isDiff = image.old !== null && image.new !== null

  // The composed frame both revisions are centered in (max of both sizes).
  const frame = useMemo(() => {
    if (oldImage && newImage) return composedSize(oldImage, newImage)
    const single = newImage ?? oldImage
    return single ? { width: single.width, height: single.height } : null
  }, [oldImage, newImage])

  const panZoom = usePanZoom(frame)

  // New file selected: stats and blend belong to the previous pair.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the image payload identity by design.
  useEffect(() => {
    setStats(null)
    setBlend(0.5)
  }, [image])

  const onStats = useCallback((s: DiffStats) => setStats(s), [])

  // Keyboard zoom on the focused stage: +/− step, 0 fits, 1 is 100%.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') panZoom.zoomIn()
      else if (e.key === '-') panZoom.zoomOut()
      else if (e.key === '0') panZoom.zoomToFit()
      else if (e.key === '1') panZoom.zoomToActualSize()
      else return
      e.preventDefault()
    },
    [panZoom]
  )

  if (oldState.status === 'error' || newState.status === 'error') {
    return (
      <div className="center-state">
        <div className="icon-ring">
          <Icon.Image size={22} />
        </div>
        <h3>Couldn't display this image</h3>
        <p>The file looks like an image but couldn't be decoded.</p>
      </div>
    )
  }
  if (!frame || (isDiff && (!oldImage || !newImage))) {
    return (
      <div className="center-state">
        <div className="spinner" />
      </div>
    )
  }

  const changedPercent =
    stats && stats.coveredPixels > 0 ? (stats.changedPixels / stats.coveredPixels) * 100 : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focusable stage so the zoom keys work; all actions also have buttons.
    <div className="img-pane" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="img-stage-area">
        {!isDiff && (oldImage || newImage) && (
          <Viewport panZoom={panZoom}>
            <World panZoom={panZoom} frame={frame}>
              {oldImage && <CenteredImage image={oldImage} frame={frame} side="old" />}
              {newImage && <CenteredImage image={newImage} frame={frame} side="new" />}
            </World>
          </Viewport>
        )}
        {isDiff && oldImage && newImage && (
          <>
            {mode === 'onion' && (
              <OnionSkinMode
                oldImage={oldImage}
                newImage={newImage}
                frame={frame}
                panZoom={panZoom}
                blend={blend}
                onBlendChange={setBlend}
              />
            )}
            {mode === 'side-by-side' && (
              <SideBySideMode
                oldImage={oldImage}
                newImage={newImage}
                frame={frame}
                panZoom={panZoom}
              />
            )}
            {mode === 'differences' && (
              <DifferencesMode
                oldImage={oldImage}
                newImage={newImage}
                frame={frame}
                panZoom={panZoom}
                cache={diffCache}
                onStats={onStats}
              />
            )}
            {mode === 'swipe' && (
              <SwipeMode oldImage={oldImage} newImage={newImage} frame={frame} panZoom={panZoom} />
            )}
          </>
        )}

        {isDiff && (
          <div className="img-modes segmented">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={mode === m.id ? 'is-active' : ''}
                data-tip={m.label}
                aria-label={m.label}
                onClick={() => setMode(m.id)}
              >
                {m.icon(15)}
              </button>
            ))}
          </div>
        )}

        <div className="img-zoom">
          <button
            className="img-zoom__pct"
            data-tip="Zoom to fit"
            onClick={() => panZoom.zoomToFit()}
          >
            {zoomLabel(panZoom.transform.scale)}
          </button>
          <button className="icon-btn" data-tip="Zoom in" onClick={() => panZoom.zoomIn()}>
            <Icon.ZoomIn size={15} />
          </button>
          <button className="icon-btn" data-tip="Zoom out" onClick={() => panZoom.zoomOut()}>
            <Icon.ZoomOut size={15} />
          </button>
          <button
            className={`icon-btn${panZoom.fitted ? ' is-active' : ''}`}
            data-tip="Zoom to fit"
            onClick={() => panZoom.zoomToFit()}
          >
            <Icon.Fit size={15} />
          </button>
          <button
            className="icon-btn"
            data-tip="Actual size"
            onClick={() => panZoom.zoomToActualSize()}
          >
            <Icon.ActualSize size={15} />
          </button>
        </div>

        <div className="img-hud">
          {oldImage && image.old && (
            <span className="img-hud__side img-hud__side--old">
              {sideLabel(oldImage, image.old.bytes)}
            </span>
          )}
          {oldImage && newImage && <span className="img-hud__arrow">→</span>}
          {newImage && image.new && (
            <span className="img-hud__side img-hud__side--new">
              {sideLabel(newImage, image.new.bytes)}
            </span>
          )}
          {mode === 'differences' && isDiff && changedPercent !== null && (
            <span className="img-hud__stat">
              {changedPercent === 0
                ? 'pixel-identical'
                : `${changedPercent < 0.1 ? '< 0.1' : changedPercent.toFixed(1)}% of pixels differ`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
