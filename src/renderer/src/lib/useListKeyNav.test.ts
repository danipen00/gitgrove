import { describe, expect, it } from 'bun:test'
import { navTarget } from './useListKeyNav'

describe('navTarget', () => {
  it('moves one step with the arrows, clamped at the edges', () => {
    expect(navTarget('ArrowDown', 0, 5, 3)).toBe(1)
    expect(navTarget('ArrowDown', 4, 5, 3)).toBe(4)
    expect(navTarget('ArrowUp', 3, 5, 3)).toBe(2)
    expect(navTarget('ArrowUp', 0, 5, 3)).toBe(0)
  })

  it('jumps a page with PageUp/PageDown, clamped at the edges', () => {
    expect(navTarget('PageDown', 1, 10, 4)).toBe(5)
    expect(navTarget('PageDown', 8, 10, 4)).toBe(9)
    expect(navTarget('PageUp', 6, 10, 4)).toBe(2)
    expect(navTarget('PageUp', 1, 10, 4)).toBe(0)
  })

  it('jumps to the ends with Home/End', () => {
    expect(navTarget('Home', 7, 10, 4)).toBe(0)
    expect(navTarget('End', 2, 10, 4)).toBe(9)
  })

  it('ignores keys that are not navigation', () => {
    expect(navTarget('a', 2, 10, 4)).toBeNull()
    expect(navTarget('Escape', 2, 10, 4)).toBeNull()
    expect(navTarget('Tab', 2, 10, 4)).toBeNull()
  })
})
