import { describe, expect, test } from 'bun:test'
import type { DiffPayload } from '@shared/types'
import { samePayload } from './useDiffLoader'

const payload = (partial: Partial<DiffPayload> = {}): DiffPayload => ({
  patch: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-x\n+y\n',
  path: 'a.txt',
  status: 'modified',
  binary: false,
  ...partial
})

describe('samePayload', () => {
  test('identical content compares equal, so a refresh keeps the old object', () => {
    expect(samePayload(payload(), payload())).toBe(true)
  })

  test('nothing equals a missing previous payload', () => {
    expect(samePayload(null, payload())).toBe(false)
  })

  test('any changed field breaks equality', () => {
    expect(samePayload(payload(), payload({ patch: 'changed' }))).toBe(false)
    expect(samePayload(payload(), payload({ path: 'b.txt' }))).toBe(false)
    expect(samePayload(payload(), payload({ status: 'deleted' }))).toBe(false)
    expect(samePayload(payload(), payload({ notice: 'Too large.' }))).toBe(false)
    expect(samePayload(payload(), payload({ oldContents: 'x', newContents: 'y' }))).toBe(false)
  })
})
