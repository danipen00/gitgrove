import { createRoot } from 'react-dom/client'
import { preloadHighlighter } from '@pierre/diffs'

import { App } from './App'
import { applyInitialTheme } from './lib/theme'
import './styles/global.css'

applyInitialTheme()

// Warm pierre's shared Shiki highlighter before any diff mounts, so the very first
// diff paints synchronously instead of after an async highlighter load.
void preloadHighlighter({ themes: ['pierre-light', 'pierre-dark'], langs: [] })

// NOTE: intentionally *not* wrapped in <StrictMode>. Pierre's diff/tree views are
// imperative components (refs + shadow DOM + an async-loaded Shiki highlighter) and
// are not safe under StrictMode's dev-only mount→unmount→remount. Concretely: the
// throw-away first FileDiff instance renders an empty <pre> while the highlighter is
// still loading, then is torn down leaving that <pre> in the shadow DOM; the
// surviving instance "hydrates" the leftover <pre> and never repaints when
// highlighting finishes — so the first file selected after opening a repo rendered
// blank until a fresh diff was mounted (e.g. visiting History and back). This only
// affected dev; production (single mount) was always fine.
createRoot(document.getElementById('root')!).render(<App />)
