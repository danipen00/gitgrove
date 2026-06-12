// Blink: the two revisions alternate in place — the comparator's trick. The
// eye is a superb motion detector, so anything that moved or changed pops
// without any overlay arithmetic. Both layers stay mounted (the flip is pure
// opacity, so it can never flash a decode); a floating control pauses the
// loop and the side chip flips manually while studying one frame.

import { useEffect, useState } from 'react'
import type { AnchorMode } from '@/lib/image-diff'
import { Icon } from '@/lib/icons'
import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { ImageLayer, Viewport, World } from './stage'

/** Half a period: each revision holds the screen this long. */
const BLINK_INTERVAL_MS = 500

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
  anchor: AnchorMode
}

export function BlinkMode({ oldImage, newImage, frame, panZoom, anchor }: Props) {
  const [playing, setPlaying] = useState(true)
  const [showNew, setShowNew] = useState(true)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setShowNew((s) => !s), BLINK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [playing])

  return (
    <Viewport panZoom={panZoom}>
      <World panZoom={panZoom} frame={frame}>
        <ImageLayer image={oldImage} frame={frame} side="old" anchor={anchor} />
        <ImageLayer
          image={newImage}
          frame={frame}
          side="new"
          anchor={anchor}
          opacity={showNew ? 1 : 0}
        />
      </World>
      <div className="img-pill img-blink-control">
        <button
          className="icon-btn"
          data-tip={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Icon.Pause size={13} /> : <Icon.Play size={13} />}
        </button>
        {/* Clicking the side chip pauses and flips — "hold on, show me the
            other one" is one click, not pause-then-flip. Both labels stay in
            the layout stacked on one grid cell (the inactive one invisible),
            so the chip keeps one exact width and the control itself never
            blinks while the words alternate. */}
        <button
          className={`img-blink-side${showNew ? ' img-blink-side--new' : ''}`}
          data-tip="Show the other revision"
          onClick={() => {
            setPlaying(false)
            setShowNew((s) => !s)
          }}
        >
          <span aria-hidden={showNew}>Old</span>
          <span aria-hidden={!showNew}>New</span>
        </button>
      </div>
    </Viewport>
  )
}
