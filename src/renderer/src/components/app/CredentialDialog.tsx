// In-app credential prompt — the UI half of the askpass flow. While a
// fetch/pull/push/clone waits on a username, password/token or SSH key
// passphrase, the main process pushes a prompt here; the answer goes straight
// to the waiting git process and is never stored, so the input is cleared the
// moment the dialog resolves. Cancelling makes git abort the operation.
//
// When the host supports browser sign-in (github.com, or an Enterprise host
// with a known OAuth app), that becomes the primary action: it both rescues
// the waiting operation — main answers the prompt from the new account and
// dismisses this dialog — and connects the account for every future one.
// Manual entry stays available underneath.

import type { CredentialPromptRequest, DeviceCodeInfo } from '@shared/types'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { DeviceCodePanel } from '@/components/settings/DeviceCodePanel'
import { prettyPath } from '@/lib/format'
import { Icon } from '@/lib/icons'

interface Props {
  request: CredentialPromptRequest
  /** Whether one-click browser sign-in is possible for the prompt's host. */
  oauthAvailable: boolean
  /** Deliver the answer; null cancels the underlying git operation. */
  onRespond: (requestId: string, value: string | null) => void
}

export function CredentialDialog({ request, oauthAvailable, onRespond }: Props) {
  const [value, setValue] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const oauthRunning = useRef(false)
  const { requestId, kind, host, keyPath } = request

  useEffect(() => window.gitgrove.onAccountDeviceCode(setDeviceInfo), [])
  // The dialog can unmount mid-sign-in (main answered the prompt, or the
  // prompt expired) — by then a *successful* flow is already finished, so
  // this only stops genuinely abandoned polling.
  useEffect(() => {
    return () => {
      if (oauthRunning.current) window.gitgrove.cancelAccountOAuth()
    }
  }, [])

  const title = kind === 'passphrase' ? 'Unlock SSH key' : host ? `Sign in to ${host}` : 'Sign in'
  const label =
    kind === 'username'
      ? 'Username'
      : kind === 'password'
        ? 'Password or access token'
        : 'Passphrase'

  const respond = (answer: string | null) => {
    setValue('')
    onRespond(requestId, answer)
  }
  // An empty answer is never a real credential — git would treat '' as a failed
  // username/password and re-prompt, a confusing dead end (an unencrypted key
  // never reaches this dialog). Block submitting nothing (Enter included);
  // Cancel is the way out.
  const canSubmit = value.length > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (canSubmit) respond(value)
  }

  const signInWithBrowser = async () => {
    if (!host) return
    setOauthError(null)
    setDeviceInfo(null)
    setSigningIn(true)
    oauthRunning.current = true
    const result = await window.gitgrove.beginAccountOAuth(host)
    oauthRunning.current = false
    // Success needs nothing from us: main answers the waiting prompt from the
    // new account and dismisses this dialog.
    if (!result.ok && result.code !== 'cancelled') {
      setSigningIn(false)
      setOauthError('Browser sign-in did not finish — you can enter credentials manually.')
    }
  }

  const stopSigningIn = () => {
    window.gitgrove.cancelAccountOAuth()
    oauthRunning.current = false
    setSigningIn(false)
  }

  if (signingIn && host) {
    return (
      <DialogShell title={title} icon={<Icon.Github size={22} />} onClose={stopSigningIn}>
        <DeviceCodePanel host={host} info={deviceInfo} />
        <div className="trust__actions">
          <button type="button" className="btn-ghost btn-ghost--sm" onClick={stopSigningIn}>
            Enter manually instead
          </button>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title={title}
      icon={<Icon.Lock size={22} />}
      onClose={() => respond(null)}
      width={420}
    >
      {oauthAvailable && kind !== 'passphrase' && (
        <>
          <button type="button" className="acct-choice" onClick={signInWithBrowser}>
            <Icon.Github size={20} />
            <span className="acct-choice__main">
              <span className="acct-choice__title">Sign in with GitHub</span>
              <span className="acct-choice__sub">
                One-time browser sign-in — never type credentials again
              </span>
            </span>
          </button>
          {oauthError && <p className="dlg-error">{oauthError}</p>}
          <p className="trust__note" style={{ textAlign: 'center' }}>
            or enter manually
          </p>
        </>
      )}
      <form onSubmit={submit}>
        {kind === 'passphrase' && keyPath && (
          <p className="trust__body">
            The key <code>{prettyPath(keyPath)}</code> is protected by a passphrase.
          </p>
        )}
        <div className="dlg-field">
          <label htmlFor="credential-value">{label}</label>
          <input
            id="credential-value"
            // Usernames are not secret; everything else is masked.
            type={kind === 'username' ? 'text' : 'password'}
            autoFocus={!oauthAvailable}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <p className="trust__note">
          Passed directly to git for this operation — GitGrove never stores it.
        </p>
        <div className="trust__actions">
          <button type="button" className="btn-ghost btn-ghost--sm" onClick={() => respond(null)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-primary--sm" disabled={!canSubmit}>
            {kind === 'passphrase' ? 'Unlock' : 'Sign in'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}
