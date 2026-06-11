import { describe, expect, test } from 'bun:test'
import { rowMetrics, windowRange } from './rowMetrics'

describe('rowMetrics — uniform rows', () => {
  const m = rowMetrics(10, 20)

  test('total is count * height', () => {
    expect(m.total).toBe(200)
  })

  test('rowTop is index * height, clamped at the ends', () => {
    expect(m.rowTop(0)).toBe(0)
    expect(m.rowTop(3)).toBe(60)
    expect(m.rowTop(10)).toBe(200) // one past the last row
    expect(m.rowTop(-5)).toBe(0)
    expect(m.rowTop(99)).toBe(200)
  })

  test('heightOf is constant', () => {
    expect(m.heightOf(0)).toBe(20)
    expect(m.heightOf(9)).toBe(20)
  })

  test('indexAt maps an offset to its row, clamped to valid indices', () => {
    expect(m.indexAt(0)).toBe(0)
    expect(m.indexAt(19)).toBe(0)
    expect(m.indexAt(20)).toBe(1)
    expect(m.indexAt(59)).toBe(2)
    expect(m.indexAt(-10)).toBe(0)
    expect(m.indexAt(10_000)).toBe(9)
  })

  test('averageHeight equals the fixed height', () => {
    expect(m.averageHeight).toBe(20)
  })
})

describe('rowMetrics — variable rows', () => {
  // Heights 10, 20, 10, 20, 10 → offsets 0, 10, 30, 40, 60, 70.
  const heights = [10, 20, 10, 20, 10]
  const m = rowMetrics(heights.length, (i) => heights[i])

  test('total is the sum of every row height', () => {
    expect(m.total).toBe(70)
  })

  test('rowTop is the cumulative offset before the row', () => {
    expect(m.rowTop(0)).toBe(0)
    expect(m.rowTop(1)).toBe(10)
    expect(m.rowTop(2)).toBe(30)
    expect(m.rowTop(3)).toBe(40)
    expect(m.rowTop(4)).toBe(60)
    expect(m.rowTop(5)).toBe(70) // one past the last row
  })

  test('heightOf returns each row’s own height', () => {
    expect(heights.map((_, i) => m.heightOf(i))).toEqual(heights)
  })

  test('indexAt finds the row that spans the offset', () => {
    expect(m.indexAt(0)).toBe(0)
    expect(m.indexAt(9)).toBe(0)
    expect(m.indexAt(10)).toBe(1)
    expect(m.indexAt(29)).toBe(1)
    expect(m.indexAt(30)).toBe(2)
    expect(m.indexAt(45)).toBe(3)
    expect(m.indexAt(69)).toBe(4)
    expect(m.indexAt(70)).toBe(4) // at/after the end clamps to the last row
    expect(m.indexAt(-1)).toBe(0)
  })

  test('indexAt round-trips rowTop for every row', () => {
    for (let i = 0; i < heights.length; i++) {
      expect(m.indexAt(m.rowTop(i))).toBe(i)
    }
  })

  test('averageHeight is the mean row height', () => {
    expect(m.averageHeight).toBe(70 / 5)
  })
})

describe('rowMetrics — empty list', () => {
  const m = rowMetrics(0, (i) => 10 + i)

  test('is all zeroes and never throws', () => {
    expect(m.total).toBe(0)
    expect(m.rowTop(0)).toBe(0)
    expect(m.indexAt(0)).toBe(0)
    expect(m.indexAt(100)).toBe(0)
    expect(m.averageHeight).toBe(0)
  })
})

describe('windowRange', () => {
  test('uniform: covers the viewport plus overscan on both sides', () => {
    const m = rowMetrics(100, 20)
    // Scrolled to 200px (row 10), 100px tall viewport (rows 10..14), overscan 2.
    const { start, end } = windowRange(m, 100, 200, 100, 2, 0)
    expect(start).toBe(8) // 10 - 2
    expect(end).toBe(17) // last visible row 14, +1 exclusive, +2 overscan
  })

  test('clamps to the list bounds at the very top and bottom', () => {
    const m = rowMetrics(100, 20)
    const top = windowRange(m, 100, 0, 100, 4, 0)
    expect(top.start).toBe(0)
    const bottom = windowRange(m, 100, 2000, 100, 4, 0)
    expect(bottom.end).toBe(100)
  })

  test('accounts for padTop', () => {
    const m = rowMetrics(100, 20)
    // 8px of padding above row 0; a scrollTop of 8 sits exactly at row 0.
    const { start } = windowRange(m, 100, 8, 100, 0, 8)
    expect(start).toBe(0)
  })

  test('variable: window follows the prefix-sum offsets', () => {
    const heights = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 10 : 30))
    const m = rowMetrics(heights.length, (i) => heights[i])
    // offset of row 10 = 5*(10+30) = 200; a 40px viewport spans row 10 (10px,
    // 200..210) and row 11 (30px, 210..240) exactly. No overscan keeps it exact.
    const { start, end } = windowRange(m, heights.length, 200, 40, 0, 0)
    expect(start).toBe(10)
    expect(end).toBe(12)
  })

  test('empty list yields an empty window', () => {
    const m = rowMetrics(0, 20)
    expect(windowRange(m, 0, 0, 100, 4, 0)).toEqual({ start: 0, end: 0 })
  })
})
