// Side by side: old and new in two synchronized panes. Both halves bind the
// same PanZoom, so zooming or panning either one moves both — comparing the
// same region never needs manual re-alignment.

import type { DecodedImage } from '@/lib/useDecodedImage'
import type { PanZoom } from '@/lib/usePanZoom'
import { CenteredImage, Viewport, World } from './stage'

interface Props {
  oldImage: DecodedImage
  newImage: DecodedImage
  frame: { width: number; height: number }
  panZoom: PanZoom
}

export function SideBySideMode({ oldImage, newImage, frame, panZoom }: Props) {
  return (
    <div className="img-sbs">
      <Viewport panZoom={panZoom} className="img-sbs__pane">
        <World panZoom={panZoom} frame={frame}>
          <CenteredImage image={oldImage} frame={frame} side="old" />
        </World>
        <span className="img-side-chip img-side-chip--old">Old</span>
      </Viewport>
      <Viewport panZoom={panZoom} className="img-sbs__pane">
        <World panZoom={panZoom} frame={frame}>
          <CenteredImage image={newImage} frame={frame} side="new" />
        </World>
        {/* Outer corner: the inner one sits under the floating mode switcher. */}
        <span className="img-side-chip img-side-chip--new img-side-chip--right">New</span>
      </Viewport>
    </div>
  )
}
