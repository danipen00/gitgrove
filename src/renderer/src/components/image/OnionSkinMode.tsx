// Onion skin: the new revision is layered over the old one and a slider
// blends between them — the classic way to spot what moved. The slider
// floats over the stage (top center) so the pixels keep the whole pane.

import type { AnchorMode } from '@/lib/image-diff'
import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { ImageLayer, Viewport, World } from './stage'

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
  anchor: AnchorMode
  /** 0 = all old, 1 = all new. Owned by the viewer so it survives mode trips. */
  blend: number
  onBlendChange: (blend: number) => void
}

export function OnionSkinMode({
  oldImage,
  newImage,
  frame,
  panZoom,
  anchor,
  blend,
  onBlendChange
}: Props) {
  return (
    <Viewport panZoom={panZoom}>
      <World panZoom={panZoom} frame={frame}>
        <ImageLayer image={oldImage} frame={frame} side="old" anchor={anchor} />
        <ImageLayer image={newImage} frame={frame} side="new" anchor={anchor} opacity={blend} />
      </World>
      <div className="img-pill img-onion-slider">
        <span className="img-pill__label">Old</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={blend}
          aria-label="Blend between old and new revision"
          onChange={(e) => onBlendChange(Number(e.target.value))}
        />
        <span className="img-pill__label">New</span>
      </div>
    </Viewport>
  )
}
