// useState backed by localStorage: layout preferences (splitter sizes, diff
// mode, …) survive app restarts. Reads once on mount, writes on every set;
// storage failures (private mode, quota) silently fall back to memory-only.

import { useCallback, useState } from 'react'

export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    },
    [key]
  )
  return [value, set]
}
