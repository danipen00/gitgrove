import { describe, expect, it } from 'bun:test'

import { describeUpdateError } from './update-error'

describe('describeUpdateError', () => {
  // The real payload electron-updater threw for a draft-only release: a single
  // unbroken line carrying the request, the 404, and every response header —
  // including Set-Cookie session tokens. This is what smeared across the window.
  const raw404 =
    'HttpError: 404 "method: GET url: https://github.com/danipen/gitgrove/releases.atom\r\n' +
    '\nPlease double check that your authentication token is correct. Due to security ' +
    'reasons, actual status maybe not reported, but 404.\n" Headers: { "set-cookie": ' +
    '[ "_gh_sess=SECRETSESSIONTOKEN; path=/; HttpOnly; secure; SameSite=Lax" ] }'

  it('maps a 404 to a friendly line and drops the raw response + cookies', () => {
    const out = describeUpdateError(new Error(raw404))
    expect(out).toBe('No published release is available to update from yet.')
    expect(out).not.toContain('set-cookie')
    expect(out).not.toContain('_gh_sess')
    expect(out).not.toContain('Headers')
  })

  it('maps a 404 carried via statusCode', () => {
    expect(describeUpdateError({ statusCode: 404, message: 'whatever' })).toBe(
      'No published release is available to update from yet.'
    )
  })

  it('reports connection problems by code', () => {
    expect(describeUpdateError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND github.com' })).toBe(
      "Couldn't reach the update server. Check your connection and try again."
    )
  })

  it('reports connection problems detected in the message', () => {
    expect(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(
      "Couldn't reach the update server. Check your connection and try again."
    )
  })

  it('strips the Error: prefix and headers from unknown errors', () => {
    const out = describeUpdateError(new Error('HttpError: 500 server exploded Headers: { "x": 1 }'))
    expect(out).toBe('500 server exploded')
  })

  it('keeps only the first line of multi-line messages', () => {
    expect(describeUpdateError(new Error('boom\nstack frame 1\nstack frame 2'))).toBe('boom')
  })

  it('truncates very long single-line messages', () => {
    const out = describeUpdateError(new Error('x'.repeat(500)))
    expect(out.length).toBe(141) // 140 chars + ellipsis
    expect(out.endsWith('…')).toBe(true)
  })

  it('falls back to "unknown error" for empty / nullish input', () => {
    expect(describeUpdateError(null)).toBe('unknown error')
    expect(describeUpdateError(new Error(''))).toBe('unknown error')
  })
})
