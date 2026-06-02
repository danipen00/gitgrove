// Theme handling. The user picks a *preference* (system / light / dark) which we
// persist; the *resolved* theme is what actually drives the UI ('light' | 'dark').
// 'system' tracks the OS color scheme live via matchMedia.
//
// The resolved theme is reflected onto <html data-theme="…">, which flips the CSS
// custom properties in global.css. It's also passed to the diff viewer so it can
// pick the matching Shiki/pierre theme.

import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'gg.theme'

export function readThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

/** Set <html data-theme> before React mounts so there's no flash of the wrong theme. */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(readThemePref())
}

export function useTheme(): {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (pref: ThemePref) => void
} {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  // Keep the 'system' option live as the OS scheme changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = pref === 'system' ? system : pref

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  return { pref, resolved, setPref }
}
