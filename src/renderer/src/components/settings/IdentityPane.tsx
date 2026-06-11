// Settings → Identity: edit the machine-wide commit identity (global git
// config user.name / user.email) — the same values the first-commit dialog
// collects, now editable any time. Repo-local overrides are shown as a hint
// but never touched from here: this pane is exactly `git config --global`.

import type { GlobalIdentity } from '@shared/types'
import { type FormEvent, useEffect, useState } from 'react'

interface Props {
  /** Open repository, to surface a local identity override when one exists. */
  repoPath?: string
}

export function IdentityPane({ repoPath }: Props) {
  const [loaded, setLoaded] = useState<GlobalIdentity | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [localOverride, setLocalOverride] = useState<GlobalIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.gitgrove.getGlobalIdentity().then((identity) => {
      if (!alive) return
      setLoaded(identity)
      setName(identity.name)
      setEmail(identity.email)
    })
    if (repoPath) {
      window.gitgrove.getIdentity(repoPath).then((identity) => {
        if (alive) setLocalOverride(identity.source === 'local' ? identity : null)
      })
    }
    return () => {
      alive = false
    }
  }, [repoPath])

  const dirty = loaded !== null && (name !== loaded.name || email !== loaded.email)
  const valid = name.trim().length > 0 && /\S+@\S+/.test(email.trim())

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || !valid) return
    setBusy(true)
    setError(null)
    try {
      await window.gitgrove.setGlobalIdentity(name.trim(), email.trim())
      setLoaded({ name: name.trim(), email: email.trim() })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loaded === null) {
    return (
      <div className="center-state" style={{ padding: 24 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <form onSubmit={save}>
      <p className="trust__body" style={{ marginBottom: 10 }}>
        Every commit records this name and email as its author, in every repository.
      </p>
      <div className="dlg-field">
        <label htmlFor="identity-name">Name</label>
        <input
          id="identity-name"
          placeholder="Ada Lovelace"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="dlg-field">
        <label htmlFor="identity-email">Email</label>
        <input
          id="identity-email"
          placeholder="ada@example.com"
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {localOverride && (
        <p className="trust__note">
          The open repository overrides this with {localOverride.name} &lt;{localOverride.email}
          &gt; (set on its first commit).
        </p>
      )}
      {error && <p className="dlg-error">{error}</p>}
      <div className="trust__actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="submit"
          className="btn-primary btn-primary--sm"
          disabled={busy || !dirty || !valid}
        >
          {busy && <span className="about__spinner" aria-hidden />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </form>
  )
}
