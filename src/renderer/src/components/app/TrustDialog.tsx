import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/lib/icons'

interface Props {
  /** The folder git flagged as untrusted. */
  path: string
  /** True while the trust exception is being persisted and the repo opened. */
  busy: boolean
  onTrust: () => void
  onCancel: () => void
}

/**
 * Shown when git refuses a repo with "dubious ownership" (common on Parallels
 * shares / network drives). Explains the situation and lets the user
 * explicitly trust the folder — which persists a `safe.directory` exception —
 * rather than silently trusting everything.
 */
export function TrustDialog({ path, busy, onTrust, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        className="modal trust"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="trust__head">
          <span className="trust__icon">
            <Icon.Alert size={22} />
          </span>
          <h2 className="trust__title">Trust this repository?</h2>
        </div>

        <p className="trust__body">
          The git repository at <code className="trust__path">{path}</code> is on a filesystem that
          doesn’t record ownership — common for Parallels shared folders and network drives — so git
          won’t open it until you confirm you trust it.
        </p>
        <p className="trust__note">
          Opening an untrusted repository can run files from it. Only continue if you trust where it
          came from. GitGrove will remember this folder.
        </p>

        <div className="trust__actions">
          <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary btn-primary--sm" onClick={onTrust} disabled={busy}>
            {busy && <span className="about__spinner" aria-hidden />}
            {busy ? 'Opening…' : 'Trust & Open'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
