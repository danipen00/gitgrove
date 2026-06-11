// The waiting room of a browser sign-in (device flow): shows the one-time
// code while the main process polls for the user to finish in the browser.
// To keep typing to zero, the code is auto-copied and the browser auto-opened
// the moment the code arrives — the user just pastes and approves.

import type { DeviceCodeInfo } from '@shared/types'
import { useEffect, useState } from 'react'
import { Icon } from '@/lib/icons'

interface Props {
  host: string
  /** Null while the code is being requested from the host. */
  info: DeviceCodeInfo | null
}

export function DeviceCodePanel({ host, info }: Props) {
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!info) return
    window.gitgrove.clipboardWrite(info.userCode)
    window.gitgrove.openExternal(info.verificationUri)
  }, [info])

  // Drive the expiry countdown; a stale "15:00" would look frozen/broken.
  useEffect(() => {
    if (!info) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [info])

  if (!info) {
    return (
      <div className="device-wait">
        <span className="spinner spinner--sm" />
        <span>Contacting {host}…</span>
      </div>
    )
  }

  const remainingSec = Math.max(0, Math.floor((info.expiresAt - now) / 1000))
  const countdown = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`

  const copy = () => {
    window.gitgrove.clipboardWrite(info.userCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="device-panel">
      <p className="trust__body">
        Your browser opened {host} — enter this code there to finish signing in:
      </p>
      <button
        type="button"
        className="device-code"
        onClick={copy}
        data-tip={copied ? 'Copied!' : 'Click to copy'}
      >
        {info.userCode}
        <Icon.Copy size={14} />
      </button>
      <p className="trust__note">
        The code is already on your clipboard · expires in {countdown}.{' '}
        <button
          type="button"
          className="link-button"
          onClick={() => window.gitgrove.openExternal(info.verificationUri)}
        >
          Reopen browser
        </button>
      </p>
      <div className="device-wait">
        <span className="spinner spinner--sm" />
        <span>Waiting for you to approve in the browser…</span>
      </div>
    </div>
  )
}
