import { describe, expect, test } from 'bun:test'
import type { UpdateStatus } from '@shared/types'
import { bannerUpdateFor } from './useUpdateBanner'

const status = (
  partial: Partial<UpdateStatus> & { state: UpdateStatus['state'] }
): UpdateStatus => ({
  version: '1.0.0',
  manual: false,
  ...partial
})

describe('bannerUpdateFor', () => {
  test('no status → no banner', () => {
    expect(bannerUpdateFor(null, null, false, false)).toBeNull()
  })

  test('download progress always shows', () => {
    const downloading = status({ state: 'downloading', percent: 40 })
    expect(bannerUpdateFor(downloading, null, false, false)).toBe(downloading)
  })

  test('a ready update shows until dismissed for exactly that version', () => {
    const ready = status({ state: 'downloaded', newVersion: '2.0.0' })
    expect(bannerUpdateFor(ready, null, false, false)).toBe(ready)
    expect(bannerUpdateFor(ready, '2.0.0', false, false)).toBeNull()
    // A different version becoming ready is not covered by the old dismissal.
    expect(bannerUpdateFor(ready, '1.9.0', false, false)).toBe(ready)
  })

  test('manual-check feedback shows, then hides once dismissed', () => {
    const upToDate = status({ state: 'not-available', manual: true })
    expect(bannerUpdateFor(upToDate, null, false, false)).toBe(upToDate)
    expect(bannerUpdateFor(upToDate, null, true, false)).toBeNull()
  })

  test('manual-check feedback hides while the About dialog shows the same status', () => {
    const checking = status({ state: 'checking', manual: true })
    expect(bannerUpdateFor(checking, null, false, true)).toBeNull()
  })

  test('background (non-manual) checks never flash feedback', () => {
    expect(bannerUpdateFor(status({ state: 'not-available' }), null, false, false)).toBeNull()
    expect(bannerUpdateFor(status({ state: 'error', error: 'x' }), null, false, false)).toBeNull()
  })
})
