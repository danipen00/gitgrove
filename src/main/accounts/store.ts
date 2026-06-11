// Connected-accounts persistence. Account metadata lives in a JSON file in
// userData; the access token is encrypted by the injected cipher (OS vault via
// Electron safeStorage in production — see cipher.ts) and only its ciphertext
// touches disk. When no real encryption is available (Linux without a
// keyring), tokens are kept in memory for the session instead of being
// written ~plaintext: the account still works, it just isn't remembered.
//
// This module is deliberately Electron-free so the whole store is unit-
// testable with a temp file and a fake cipher.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeHost } from '@shared/git-hosts'
import type { AccountProvider, ConnectedAccount, CredentialPrompt } from '@shared/types'

/** Encrypts tokens at rest. `encrypt` returns an opaque printable payload. */
export interface AccountCipher {
  available(): boolean
  encrypt(text: string): string
  /** Null when the payload can't be decrypted (key lost, file copied across machines). */
  decrypt(payload: string): string | null
}

/** What a successful sign-in hands the store (token passed separately). */
export interface AccountProfile {
  provider: AccountProvider
  host: string
  login: string
  name: string | null
  email: string | null
  scopes: string[]
}

interface StoredAccount extends AccountProfile {
  tokenCipher: string
}

interface StoreFile {
  accounts: StoredAccount[]
  /** Enterprise OAuth client IDs remembered per host after a first sign-in. */
  clientIds: Record<string, string>
}

export function accountId(host: string, login: string): string {
  return `${normalizeHost(host)}/${login}`
}

export class AccountsStore {
  /** Session-only tokens for accounts the cipher couldn't protect at rest. */
  private sessionTokens = new Map<string, string>()
  private sessionAccounts: StoredAccount[] = []

  constructor(
    private readonly file: string,
    private readonly cipher: AccountCipher
  ) {}

  listAccounts(): ConnectedAccount[] {
    const persisted = this.read().accounts.map((a) => this.toPublic(a, true))
    const session = this.sessionAccounts.map((a) => this.toPublic(a, false))
    return [...persisted, ...session]
  }

  /** The one account connected for `host`, or null. One account per host. */
  getAccountForHost(host: string): ConnectedAccount | null {
    const wanted = normalizeHost(host)
    return this.listAccounts().find((a) => a.host === wanted) ?? null
  }

  /** Decrypted token for `host`, or null (no account / undecryptable). */
  getTokenForHost(host: string): string | null {
    const wanted = normalizeHost(host)
    const session = this.sessionAccounts.find((a) => a.host === wanted)
    if (session) return this.sessionTokens.get(accountId(session.host, session.login)) ?? null
    const stored = this.read().accounts.find((a) => a.host === wanted)
    return stored ? this.cipher.decrypt(stored.tokenCipher) : null
  }

  /**
   * Connect (or replace — one account per host keeps "which credentials does
   * git get?" unambiguous) the account for the profile's host.
   */
  saveAccount(profile: AccountProfile, token: string): ConnectedAccount {
    const host = normalizeHost(profile.host)
    const record: StoredAccount = { ...profile, host, tokenCipher: '' }
    // One account per host: signing in (any login) replaces what was there.
    this.dropHostEverywhere(host)
    if (this.cipher.available()) {
      record.tokenCipher = this.cipher.encrypt(token)
      const data = this.read()
      data.accounts.push(record)
      this.write(data)
      return this.toPublic(record, true)
    }
    this.sessionAccounts.push(record)
    this.sessionTokens.set(accountId(host, profile.login), token)
    return this.toPublic(record, false)
  }

  /** Disconnect by id. Returns the removed account so callers can clean up. */
  removeAccount(id: string): ConnectedAccount | null {
    const sessionIdx = this.sessionAccounts.findIndex((a) => accountId(a.host, a.login) === id)
    if (sessionIdx >= 0) {
      const [removed] = this.sessionAccounts.splice(sessionIdx, 1)
      this.sessionTokens.delete(id)
      return this.toPublic(removed, false)
    }
    const data = this.read()
    const idx = data.accounts.findIndex((a) => accountId(a.host, a.login) === id)
    if (idx < 0) return null
    const [removed] = data.accounts.splice(idx, 1)
    this.write(data)
    return this.toPublic(removed, true)
  }

  getClientId(host: string): string | null {
    return this.read().clientIds[normalizeHost(host)] ?? null
  }

  /** Remember a working Enterprise client ID so sign-in is one click next time. */
  saveClientId(host: string, clientId: string): void {
    const data = this.read()
    data.clientIds[normalizeHost(host)] = clientId
    this.write(data)
  }

  private dropHostEverywhere(host: string): void {
    this.sessionAccounts = this.sessionAccounts.filter((a) => a.host !== host)
    const data = this.read()
    const remaining = data.accounts.filter((a) => a.host !== host)
    if (remaining.length !== data.accounts.length) {
      data.accounts = remaining
      this.write(data)
    }
  }

  private toPublic(a: StoredAccount, persisted: boolean): ConnectedAccount {
    return {
      id: accountId(a.host, a.login),
      provider: a.provider,
      host: a.host,
      login: a.login,
      name: a.name,
      email: a.email,
      scopes: a.scopes,
      persisted
    }
  }

  private read(): StoreFile {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
        const hasClientIds = parsed.clientIds && typeof parsed.clientIds === 'object'
        return {
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
          clientIds: hasClientIds ? parsed.clientIds : {}
        }
      }
    } catch {
      // Unreadable store: start fresh rather than blocking sign-in forever.
    }
    return { accounts: [], clientIds: {} }
  }

  private write(data: StoreFile): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8')
    } catch {
      // Non-fatal: the account still works this session via the read cache.
    }
  }
}

/**
 * The silent path of the askpass flow: when the prompt's host has a connected
 * account, answer the username prompt with the login and the password prompt
 * with the token — no dialog. Returns null when the store can't answer (no
 * account, SSH passphrase, undecryptable token) and the dialog should show.
 */
export function answerFromAccounts(store: AccountsStore, prompt: CredentialPrompt): string | null {
  if (!prompt.host) return null
  const account = store.getAccountForHost(prompt.host)
  if (!account) return null
  if (prompt.kind === 'username') return account.login
  if (prompt.kind === 'password') return store.getTokenForHost(prompt.host)
  return null
}
