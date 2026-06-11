import { Icon } from '@/lib/icons'

export type ToastKind = 'success' | 'error'

/** Transient notification card: tinted round badge, message, dismiss, and a
 *  countdown bar along the bottom edge showing how long the toast has left.
 *
 *  The countdown bar *is* the auto-dismiss timer: `onClose` fires from its
 *  animationend, so the visual and the dismissal can never drift apart — and
 *  hovering the toast (which pauses the CSS animation) also pauses dismissal,
 *  giving the user time to read or copy a long error. */
export function Toast({
  kind,
  message,
  onClose,
  durationMs = 6000,
  corner = false
}: {
  kind: ToastKind
  message: string
  onClose: () => void
  durationMs?: number
  /** Pin bottom-right instead of bottom-center, for feedback that continues a
   *  corner surface (e.g. the update banner's "checking…" card). */
  corner?: boolean
}) {
  return (
    <div
      className={`toast toast--${kind}${corner ? ' toast--corner' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span className="toast__badge" aria-hidden="true">
        {kind === 'success' ? <Icon.Check size={12} /> : <Icon.Close size={12} />}
      </span>
      <span className="toast__message">{message}</span>
      <button className="toast__close" onClick={onClose} title="Dismiss">
        <Icon.Close size={13} />
      </button>
      {/* Keyed on the message so a new message restarts the countdown. */}
      <span
        key={message}
        className="toast__countdown"
        style={{ animationDuration: `${durationMs}ms` }}
        onAnimationEnd={onClose}
      />
    </div>
  )
}
