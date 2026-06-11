import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialPrompt } from '@shared/types'
import { type AccountCipher, type AccountProfile, AccountsStore, answerFromAccounts } from './store'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitgrove-accounts-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Reversible fake so tests can assert what hit the disk without an OS vault. */
const fakeCipher = (available = true): AccountCipher => ({
  available: () => available,
  encrypt: (text) => `enc:${Buffer.from(text).toString('base64')}`,
  decrypt: (payload) =>
    payload.startsWith('enc:') ? Buffer.from(payload.slice(4), 'base64').toString() : null
})

const profile = (over: Partial<AccountProfile> = {}): AccountProfile => ({
  provider: 'github',
  host: 'github.com',
  login: 'octocat',
  name: 'The Octocat',
  email: 'octocat@github.com',
  scopes: ['repo', 'workflow'],
  ...over
})

let storeSeq = 0
const newStore = (cipher = fakeCipher()) =>
  new AccountsStore(join(dir, `accounts-${++storeSeq}.json`), cipher)

describe('AccountsStore', () => {
  test('round-trips an account and serves its token', () => {
    const store = newStore()
    const account = store.saveAccount(profile(), 't0ken')
    expect(account.id).toBe('github.com/octocat')
    expect(account.persisted).toBe(true)
    expect(store.listAccounts()).toHaveLength(1)
    expect(store.getAccountForHost('GitHub.com')?.login).toBe('octocat')
    expect(store.getTokenForHost('github.com')).toBe('t0ken')
  })

  test('the raw token never reaches the file, only ciphertext', () => {
    const store = newStore()
    store.saveAccount(profile({ login: 'cipher-check' }), 'super-secret')
    const file = join(dir, `accounts-${storeSeq}.json`)
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).not.toContain('super-secret')
    expect(onDisk).toContain('enc:')
  })

  test('one account per host: a new sign-in replaces the old one', () => {
    const store = newStore()
    store.saveAccount(profile({ login: 'old-login' }), 'old')
    store.saveAccount(profile({ login: 'new-login' }), 'new')
    const accounts = store.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].login).toBe('new-login')
    expect(store.getTokenForHost('github.com')).toBe('new')
  })

  test('removeAccount disconnects and reports what was removed', () => {
    const store = newStore()
    store.saveAccount(profile(), 'tok')
    const removed = store.removeAccount('github.com/octocat')
    expect(removed?.host).toBe('github.com')
    expect(store.listAccounts()).toHaveLength(0)
    expect(store.getTokenForHost('github.com')).toBeNull()
    expect(store.removeAccount('github.com/octocat')).toBeNull()
  })

  test('without usable encryption the token stays off disk (session only)', () => {
    const store = newStore(fakeCipher(false))
    const account = store.saveAccount(profile({ host: 'ghe.corp.example' }), 'session-secret')
    expect(account.persisted).toBe(false)
    expect(store.getTokenForHost('ghe.corp.example')).toBe('session-secret')
    const file = join(dir, `accounts-${storeSeq}.json`)
    // Nothing was written at all — a fresh store sees no account.
    expect(new AccountsStore(file, fakeCipher(false)).listAccounts()).toHaveLength(0)
  })

  test('client IDs are remembered per host, case-insensitively', () => {
    const store = newStore()
    expect(store.getClientId('ghe.corp.example')).toBeNull()
    store.saveClientId('GHE.corp.example', 'Iv1.abc')
    expect(store.getClientId('ghe.corp.example')).toBe('Iv1.abc')
  })

  test('drops malformed entries from a corrupt/hand-edited store file', () => {
    const file = join(dir, `accounts-${++storeSeq}.json`)
    writeFileSync(
      file,
      JSON.stringify({
        accounts: [
          { host: 5, login: 'x' }, // host not a string — would throw in normalizeHost
          { provider: 'github', host: 'github.com', login: 'good' }, // missing tokenCipher/scopes
          {
            provider: 'github',
            host: 'github.com',
            login: 'good',
            name: null,
            email: null,
            scopes: [],
            tokenCipher: 'enc:dG9r' // base64('tok')
          }
        ],
        clientIds: {}
      })
    )
    const store = new AccountsStore(file, fakeCipher())
    // Only the well-formed account survives; malformed ones can't crash reads.
    expect(store.listAccounts().map((a) => a.login)).toEqual(['good'])
    expect(store.getTokenForHost('github.com')).toBe('tok')
  })
})

describe('answerFromAccounts', () => {
  const prompt = (kind: CredentialPrompt['kind'], host?: string): CredentialPrompt =>
    host ? { kind, host } : { kind }

  test('answers username with the login and password with the token', () => {
    const store = newStore()
    store.saveAccount(profile(), 'the-token')
    expect(answerFromAccounts(store, prompt('username', 'github.com'))).toBe('octocat')
    expect(answerFromAccounts(store, prompt('password', 'github.com'))).toBe('the-token')
  })

  test('stays silent for unknown hosts, missing hosts and ssh passphrases', () => {
    const store = newStore()
    store.saveAccount(profile(), 'tok')
    expect(answerFromAccounts(store, prompt('password', 'gitlab.com'))).toBeNull()
    expect(answerFromAccounts(store, prompt('password'))).toBeNull()
    expect(answerFromAccounts(store, { kind: 'passphrase', keyPath: '/k' })).toBeNull()
  })

  test('answers neither half when the stored token cannot be decrypted', () => {
    // Persist with a working cipher, then reopen with one that can't decrypt
    // (key lost / file copied across machines). The account is still listed,
    // but a half-credential (username with no usable password) must not leak —
    // both halves stay silent so a full credential dialog shows instead.
    const file = join(dir, `accounts-${++storeSeq}.json`)
    new AccountsStore(file, fakeCipher()).saveAccount(profile(), 'tok')
    const undecryptable: AccountCipher = {
      available: () => true,
      encrypt: (t) => t,
      decrypt: () => null
    }
    const store = new AccountsStore(file, undecryptable)
    expect(store.getAccountForHost('github.com')?.login).toBe('octocat') // still listed
    expect(answerFromAccounts(store, prompt('username', 'github.com'))).toBeNull()
    expect(answerFromAccounts(store, prompt('password', 'github.com'))).toBeNull()
  })
})
