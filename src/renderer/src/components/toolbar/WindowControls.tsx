// Custom caption buttons (minimize / maximize-restore / close) for the
// Windows & Linux title bar, where the native frame is hidden and the toolbar
// stands in for it. macOS renders nothing here — it keeps its native traffic
// lights — so App only mounts this on non-mac platforms.

import { useEffect, useState } from 'react'

// Thin 10×10 glyphs, stroke-based to match the toolbar's icon weight.
function Minimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function Maximize({ maximized }: { maximized: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      {maximized ? (
        // Restore: two equal squares offset diagonally, matching the native
        // Windows glyph. The back square is drawn as an L (top + right edges);
        // sharp corners like the native (Segoe Fluent) glyph.
        <>
          <rect x="1" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1" />
          <path d="M3 3V1h6v6H7" stroke="currentColor" strokeWidth="1" />
        </>
      ) : (
        // Maximize: a single sharp-cornered square (no border radius), matching
        // the native glyph.
        <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" />
      )}
    </svg>
  )
}

function Close() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.gitgrove
      .windowIsMaximized()
      .then(setMaximized)
      .catch(() => {})
    return window.gitgrove.onWindowMaximized(setMaximized)
  }, [])

  return (
    <div className="winctl">
      <button
        className="winctl__btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => window.gitgrove.windowMinimize()}
      >
        <Minimize />
      </button>
      <button
        className="winctl__btn"
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => window.gitgrove.windowMaximizeToggle()}
      >
        <Maximize maximized={maximized} />
      </button>
      <button
        className="winctl__btn winctl__btn--close"
        title="Close"
        aria-label="Close"
        onClick={() => window.gitgrove.windowClose()}
      >
        <Close />
      </button>
    </div>
  )
}
