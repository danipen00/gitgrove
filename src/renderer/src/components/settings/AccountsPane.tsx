// Settings → Accounts, GitHub-Desktop minimal: the connected accounts
// (avatar, name, @login, host) plus one "Add account" — no provider wall.
// Connected accounts make git network ops sign in silently (the askpass
// responder answers from them); everything else still gets the credential
// dialog, so this pane is purely friction removal.

import type { ConnectedAccount } from '@shared/types'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/common/Dialog'
import { Avatar } from '@/components/history/Avatar'
import { Icon } from '@/lib/icons'
import { AddAccountFlow } from './AddAccountFlow'

export function AccountsPane() {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState<ConnectedAccount | null>(null)

  const reload = () => window.gitgrove.listAccounts().then(setAccounts)
  useEffect(() => {
    reload()
    return window.gitgrove.onAccountsChanged(reload)
  }, [])

  const signOut = async () => {
    if (!confirmSignOut) return
    const id = confirmSignOut.id
    setConfirmSignOut(null)
    await window.gitgrove.removeAccount(id)
  }

  if (adding) {
    return <AddAccountFlow onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
  }

  return (
    <>
      <p className="trust__body" style={{ marginBottom: 10 }}>
        Connected accounts sign in for you — push, pull and clone without typing credentials.
      </p>
      {accounts === null ? (
        <div className="center-state" style={{ padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : accounts.length === 0 ? (
        <p className="trust__note">No accounts connected yet.</p>
      ) : (
        <div className="wt-list">
          {accounts.map((account) => (
            <div key={account.id} className="wt-item">
              <Avatar
                name={account.name ?? account.login}
                email={account.email ?? ''}
                size={32}
              />
              <div className="wt-item__main">
                <span className="wt-item__branch">
                  {account.name ?? account.login}
                  {!account.persisted && (
                    <span
                      className="tag tag--current"
                      data-tip="No OS keyring was available, so this sign-in lasts until GitGrove quits."
                    >
                      this session only
                    </span>
                  )}
                </span>
                <span className="wt-item__path">
                  @{account.login} · {account.host}
                </span>
              </div>
              <div className="wt-item__actions">
                <button
                  className="section-head__action"
                  data-tip="Disconnect this account"
                  onClick={() => setConfirmSignOut(account)}
                >
                  Sign out
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="trust__actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn-ghost btn-ghost--sm" onClick={() => setAdding(true)}>
          <Icon.Plus size={14} /> Add account…
        </button>
      </div>

      {confirmSignOut && (
        <ConfirmDialog
          title={`Sign out of ${confirmSignOut.host}?`}
          body={
            <>
              GitGrove forgets <code>@{confirmSignOut.login}</code>’s token and removes it from
              your system keychain. Network operations on {confirmSignOut.host} will ask for
              credentials again.
            </>
          }
          confirmLabel="Sign out"
          onConfirm={signOut}
          onCancel={() => setConfirmSignOut(null)}
        />
      )}
    </>
  )
}
