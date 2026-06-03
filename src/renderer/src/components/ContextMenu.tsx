import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  /** Item label. Omit to render a separator instead of a clickable row. */
  label?: string
  icon?: ReactNode
  onClick?: () => void
  /** Render in the destructive (red) style — e.g. a "Remove" action. */
  danger?: boolean
  disabled?: boolean
}

interface Props {
  /** Viewport coordinates (typically the cursor) to anchor the menu's corner to. */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * A floating, cursor-anchored menu styled like the app's popovers. Renders into
 * a portal, measures itself once mounted to flip away from the right/bottom
 * edges, and closes on outside click, a second right-click, or Escape.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    setPos({ top, left })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div
        className="ctx-menu__backdrop"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        // Render off-screen-stable until measured so it never flashes at the
        // raw cursor point before the edge-clamp lands.
        style={pos ? { top: pos.top, left: pos.left } : { top: y, left: x, visibility: 'hidden' }}
      >
        {items.map((item, i) =>
          item.label === undefined ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            <div key={`sep-${i}`} className="ctx-menu__sep" />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`ctx-menu__item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
            >
              {item.icon && <span className="ctx-menu__icon">{item.icon}</span>}
              <span className="ctx-menu__label">{item.label}</span>
            </button>
          )
        )}
      </div>
    </>,
    document.body
  )
}
