import { describe, expect, it } from 'bun:test'
import { overallPercent } from './progress'

describe('overallPercent', () => {
  it('maps a phase percent into its slice of the overall scale', () => {
    // Receiving objects spans 10–85 for fetch: halfway through ≈ 47–48.
    expect(overallPercent('fetch', 'Receiving objects', 0)).toBe(10)
    expect(overallPercent('fetch', 'Receiving objects', 100)).toBe(85)
    expect(overallPercent('fetch', 'Receiving objects', 50)).toBe(48)
  })

  it('keeps phases in increasing order so the fill is monotonic', () => {
    const a = overallPercent('push', 'Compressing objects', 100)
    const b = overallPercent('push', 'Writing objects', 0)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b as number).toBeGreaterThanOrEqual(a as number)
  })

  it('maps checkout file updates onto the full scale, old phase name included', () => {
    expect(overallPercent('checkout', 'Updating files', 37)).toBe(37)
    expect(overallPercent('checkout', 'Checking out files', 37)).toBe(37)
  })

  it('returns null for phases it does not know', () => {
    expect(overallPercent('fetch', 'Enumerating objects', 50)).toBeNull()
    expect(overallPercent('checkout', 'Receiving objects', 50)).toBeNull()
  })

  it('clamps out-of-range phase percents', () => {
    expect(overallPercent('fetch', 'Resolving deltas', 150)).toBe(100)
    expect(overallPercent('fetch', 'Counting objects', -5)).toBe(0)
  })
})
