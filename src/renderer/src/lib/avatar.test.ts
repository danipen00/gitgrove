import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'

import { avatarColor, gravatarUrl, initials } from './avatar'

describe('gravatarUrl', () => {
  it('hashes the email with SHA-256 and builds the avatar URL', async () => {
    const email = 'Daniel.Penalba@Unity3D.com'
    const expectedHash = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex')

    const url = await gravatarUrl(email)
    expect(url).toBe(`https://gravatar.com/avatar/${expectedHash}?s=80&d=404`)
  })

  it('honours a custom size', async () => {
    const url = await gravatarUrl('a@b.com', 160)
    expect(url).toContain('?s=160&d=404')
  })

  it('treats differently-cased / padded emails as the same identity', async () => {
    const a = await gravatarUrl(' user@example.com ')
    const b = await gravatarUrl('USER@EXAMPLE.COM')
    expect(a).toBe(b)
  })
})

describe('initials', () => {
  it('takes first + last initial of a full name', () => {
    expect(initials('Daniel Penalba')).toBe('DP')
  })

  it('takes the first two letters of a single name', () => {
    expect(initials('Madonna')).toBe('MA')
  })

  it('splits on dots, underscores and dashes', () => {
    expect(initials('jane.q-public')).toBe('JP')
  })

  it('falls back to the email when the name is blank', () => {
    expect(initials('', 'octocat@github.com')).toBe('OC')
  })

  it('returns ? when there is nothing to work with', () => {
    expect(initials('', '')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('is deterministic for the same seed', () => {
    expect(avatarColor('alice')).toBe(avatarColor('alice'))
  })

  it('produces a valid hsl string with a hue in range', () => {
    const color = avatarColor('some-seed')
    const match = color.match(/^hsl\((\d+) 52% 48%\)$/)
    expect(match).not.toBeNull()
    const hue = Number(match![1])
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })

  it('generally differs between distinct seeds', () => {
    expect(avatarColor('alice')).not.toBe(avatarColor('bob'))
  })
})
