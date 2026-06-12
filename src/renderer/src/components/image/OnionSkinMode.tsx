// Onion skin: the new revision is layered over the old one and a slider
// blends between them — the classic way to spot what moved. The slider
// floats over the stage (top center) so the pixels keep the whole pane.

import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { CenteredImage, Viewport, World } from './stage'

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
  /** 0 = all old, 1 = all new. Owned by the viewer so it survives mode trips. */
  blend: number
  onBlendChange: (blend: number) => void
}

export function OnionSkinMode({ oldImage, newImage, frame, panZoom, blend, onBlendChange }: Props) {
  return (
    <Viewport panZoom={panZoom}>
      <World panZoom={panZoom} frame={frame}>
        <CenteredImage image={oldImage} frame={frame} side="old" />
        <CenteredImage image={newImage} frame={frame} side="new" opacity={blend} />
      </World>
      <div className="img-onion-slider">
        <span className="img-onion-slider__label">Old</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={blend}
          aria-label="Blend between old and new revision"
          onChange={(e) => onBlendChange(Number(e.target.value))}
        />
        <span className="img-onion-slider__label">New</span>
      </div>
    </Viewport>
  )
}
