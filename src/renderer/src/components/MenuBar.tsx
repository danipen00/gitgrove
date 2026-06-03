// Always-visible application menu bar for the Windows/Linux custom title bar.
// The native menu bar is hidden there (the toolbar stands in for the title bar),
// so we render the top-level labels here and pop the real native submenu on
// click — keeping every existing menu action/role without reimplementing it.

import { useEffect, useState } from 'react'

export function MenuBar() {
  const [labels, setLabels] = useState<string[]>([])
  const [openLabel, setOpenLabel] = useState<string | null>(null)

  useEffect(() => {
    window.gitgrove
      .menuLabels()
      .then(setLabels)
      .catch(() => {})
  }, [])

  if (labels.length === 0) return null

  const open = (label: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setOpenLabel(label)
    // Anchor the submenu just below the label; native popups are dismissed on
    // their own, so clear the highlight shortly after.
    window.gitgrove.menuPopup(label, r.left, r.bottom).finally(() => setOpenLabel(null))
  }

  return (
    <nav className="menubar" aria-label="Application menu">
      {labels.map((label) => (
        <button
          key={label}
          type="button"
          className={`menubar__item${openLabel === label ? ' is-open' : ''}`}
          onClick={(e) => open(label, e.currentTarget)}
          // Let hovering another label switch menus while one is open, like a
          // real menu bar.
          onMouseEnter={(e) => {
            if (openLabel && openLabel !== label) open(label, e.currentTarget)
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
