// Pure string analysis of git's and ssh's credential surface: classify the
// raw prompt an askpass helper receives, and translate auth-failure stderr
// into a human message. No I/O here — everything is directly unit-testable.

import type { CredentialPrompt } from '@shared/types'

/**
 * Classify a raw askpass prompt into what the dialog needs to show. The
 * shapes git and ssh emit (and that we must recognise) are:
 *
 *   Username for 'https://github.com':
 *   Password for 'https://user@github.com':
 *   Enter passphrase for key '/Users/x/.ssh/id_ed25519':
 *
 * Anything unrecognised falls back to a masked password-style input — wrong
 * masking on an exotic prompt is annoying; an unmasked secret is a leak.
 */
export function classifyPrompt(prompt: string): CredentialPrompt {
  const text = prompt.trim()
  const username = text.match(/^Username\s+for\s+'([^']+)'/i)
  if (username) return withHost('username', username[1])
  const password = text.match(/^Password\s+for\s+'([^']+)'/i)
  if (password) return withHost('password', password[1])
  // ssh varies: "Enter passphrase for key '<path>':" (ssh itself) and
  // "Enter passphrase for '<path>':" (ssh-add) — accept both.
  const passphrase = text.match(/passphrase\s+for\s+(?:key\s+)?'([^']+)'/i)
  if (passphrase) return { kind: 'passphrase', keyPath: passphrase[1] }
  return { kind: 'password' }
}

/** Attach the URL's host (sans any user@ prefix) when it parses, else omit it. */
function withHost(kind: 'username' | 'password', url: string): CredentialPrompt {
  try {
    const host = new URL(url).host
    return host ? { kind, host } : { kind }
  } catch {
    return { kind }
  }
}

/**
 * Map git/ssh auth-failure output to a short human message, or null when the
 * error isn't credential-related (callers then surface the original text).
 * A cancelled in-app prompt makes the askpass helper exit non-zero, which git
 * reports as "could not read Username/Password …" — distinguish that from a
 * genuine rejection so the user isn't told their valid credentials failed.
 *
 * `askpassActive` is whether an in-app prompt was actually wired up for this
 * op. git emits the very same "could not read … terminal prompts disabled"
 * when no askpass helper exists at all (setup failed, or a quiet fetch), so
 * that text only means "the user cancelled" when a prompt could have shown —
 * otherwise it's an environment failure and the raw git error is more honest.
 */
export function friendlyAuthError(stderr: string, askpassActive = true): string | null {
  if (
    askpassActive &&
    /could not read (Username|Password) for|terminal prompts disabled/i.test(stderr)
  ) {
    return 'Sign-in was cancelled, so the operation was stopped.'
  }
  const rejected = /authentication failed|invalid username or password|HTTP Basic: Access denied/i
  if (rejected.test(stderr)) {
    return 'Authentication failed — check your username and password or access token.'
  }
  if (/permission denied \(publickey/i.test(stderr)) {
    return 'SSH authentication failed — the server did not accept your key.'
  }
  return null
}
