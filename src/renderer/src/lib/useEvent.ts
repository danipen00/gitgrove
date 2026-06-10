// Stable-identity callback that always sees the latest closure. Memoized
// windowed rows keep their handler props identical across scroll renders, so
// React.memo can bail out — while the handler still reads fresh state when it
// actually fires.

import { useCallback, useLayoutEffect, useRef } from 'react'

export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
