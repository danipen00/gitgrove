// Orchestrates connecting an account: resolve which OAuth client to use, run
// the device flow (or validate a pasted token), fetch the profile, store the
// result. Expected failures come back as data (AddAccountResult) so the
// renderer never parses error strings; only programming errors throw.

import { isGitHubDotCom } from '@shared/git-hosts'
import type { AddAccountResult, DeviceCodeInfo } from '@shared/types'
import {
  AccountAuthError,
  fetchProfile,
  GITHUB_COM_CLIENT_ID,
  pollForAccessToken,
  requestDeviceCode,
  webBaseUrl
} from './github'
import type { AccountsStore } from './store'

/**
 * Which client ID a device-flow sign-in to `host` would use: the built-in app
 * for github.com, a remembered one for Enterprise hosts. Null means the UI
 * must collect one (or offer the token path instead).
 */
export function oauthClientIdFor(store: AccountsStore, host: string): string | null {
  if (isGitHubDotCom(host)) return GITHUB_COM_CLIENT_ID || null
  return store.getClientId(host)
}

export interface OAuthConnectOptions {
  /** Overrides the resolved client ID (first Enterprise sign-in). */
  clientId?: string
  signal?: AbortSignal
  /** Receives the user code to show; opening the browser is the UI's call. */
  onDeviceCode(info: DeviceCodeInfo): void
}

/** Run a full browser device-flow sign-in and store the connected account. */
export async function connectViaOAuth(
  store: AccountsStore,
  host: string,
  opts: OAuthConnectOptions
): Promise<AddAccountResult> {
  const clientId = opts.clientId ?? oauthClientIdFor(store, host)
  if (!clientId) return { ok: false, code: 'bad-client-id' }
  try {
    const grant = await requestDeviceCode(host, clientId)
    opts.onDeviceCode({
      userCode: grant.userCode,
      verificationUri: grant.verificationUri || `${webBaseUrl(host)}/login/device`,
      expiresAt: Date.now() + grant.expiresInSec * 1000
    })
    const token = await pollForAccessToken(host, clientId, grant, { signal: opts.signal })
    const account = await saveFromToken(store, host, token)
    // This client ID demonstrably works for this host — make the next
    // Enterprise sign-in (or re-sign-in) a single click.
    if (!isGitHubDotCom(host)) store.saveClientId(host, clientId)
    return { ok: true, account }
  } catch (e) {
    if (e instanceof AccountAuthError) return { ok: false, code: e.code }
    throw e
  }
}

/** Validate a pasted token against the host and store the connected account. */
export async function connectWithToken(
  store: AccountsStore,
  host: string,
  token: string
): Promise<AddAccountResult> {
  try {
    return { ok: true, account: await saveFromToken(store, host, token.trim()) }
  } catch (e) {
    if (e instanceof AccountAuthError) return { ok: false, code: e.code }
    throw e
  }
}

async function saveFromToken(store: AccountsStore, host: string, token: string) {
  const profile = await fetchProfile(host, token)
  return store.saveAccount(
    {
      provider: 'github',
      host,
      login: profile.login,
      name: profile.name,
      email: profile.email,
      scopes: profile.scopes
    },
    token
  )
}
