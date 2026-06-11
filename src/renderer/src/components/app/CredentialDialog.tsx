// In-app credential prompt — the UI half of the askpass flow. While a
// fetch/pull/push/clone waits on a username, password/token or SSH key
// passphrase, the main process pushes a prompt here; the answer goes straight
// to the waiting git process and is never stored, so the input is cleared the
// moment the dialog resolves. Cancelling makes git abort the operation.

import type { CredentialPromptRequest } from '@shared/types'
import { type FormEvent, useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { prettyPath } from '@/lib/format'
import { Icon } from '@/lib/icons'

interface Props {
  request: CredentialPromptRequest
  /** Deliver the answer; null cancels the underlying git operation. */
  onRespond: (requestId: string, value: string | null) => void
}

export function CredentialDialog({ request, onRespond }: Props) {
  const [value, setValue] = useState('')
  const { requestId, kind, host, keyPath } = request

  const title =
    kind === 'passphrase' ? 'Unlock SSH key' : host ? `Sign in to ${host}` : 'Sign in'
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
  const submit = (e: FormEvent) => {
    e.preventDefault()
    respond(value)
  }

  return (
    <DialogShell
      title={title}
      icon={<Icon.Lock size={22} />}
      onClose={() => respond(null)}
      width={420}
    >
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
            autoFocus
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
          <button type="submit" className="btn-primary btn-primary--sm">
            {kind === 'passphrase' ? 'Unlock' : 'Sign in'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}
