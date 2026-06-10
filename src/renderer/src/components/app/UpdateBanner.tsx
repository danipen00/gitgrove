import type { UpdateStatus } from '@shared/types'
import { Icon } from '@/lib/icons'

interface Props {
  update: UpdateStatus | null
  onInstall: () => void
  onDismiss: () => void
}

/**
 * Unobtrusive bottom-right card surfacing the update lifecycle. Background
 * checks stay quiet — their "checking" / "up to date" / error results show only
 * in the About dialog. But a *manual* check (Help ▸ "Check for Updates…" or the
 * About button) always gets immediate feedback here: a "checking…" card, then a
 * transient "you're on the latest version" / error card. Once an update is
 * actually downloading or ready to install the banner shows that, manual or not.
 */
export function UpdateBanner({ update, onInstall, onDismiss }: Props) {
  if (!update) return null

  // Immediate feedback for a user-initiated check. App gates these on `manual`
  // and auto-dismisses the terminal ones, so we needn't re-check `manual` here.
  if (update.state === 'checking') {
    return (
      <div className="update-banner" role="status">
        <div className="update-banner__row">
          <span className="about__spinner" aria-hidden />
          <span className="update-banner__title">Checking for updates…</span>
        </div>
      </div>
    )
  }

  if (update.state === 'not-available') {
    return (
      <div className="update-banner" role="status">
        <div className="update-banner__row">
          <span className="update-banner__icon update-banner__icon--ok" aria-hidden>
            <Icon.Check size={15} />
          </span>
          <span className="update-banner__title">You're on the latest version.</span>
          <button className="update-banner__close" title="Dismiss" onClick={onDismiss}>
            <Icon.Close size={13} />
          </button>
        </div>
      </div>
    )
  }

  if (update.state === 'error' || update.state === 'dev') {
    const dev = update.state === 'dev'
    return (
      <div className="update-banner" role="alert">
        <div className="update-banner__row">
          <span className="update-banner__icon update-banner__icon--warn" aria-hidden>
            <Icon.Alert size={15} />
          </span>
          <span className="update-banner__title">
            {dev ? 'Updates are disabled in development builds.' : "Couldn't check for updates."}
          </span>
          <button className="update-banner__close" title="Dismiss" onClick={onDismiss}>
            <Icon.Close size={13} />
          </button>
        </div>
        {!dev && update.error && <p className="update-banner__hint">{update.error}</p>}
      </div>
    )
  }

  if (update.state === 'downloading' || update.state === 'available') {
    const percent = update.state === 'downloading' ? (update.percent ?? 0) : 0
    return (
      <div className="update-banner" role="status">
        <div className="update-banner__row">
          <span className="about__spinner" aria-hidden />
          <span className="update-banner__title">
            Downloading update{update.newVersion ? ` ${update.newVersion}` : ''}…
          </span>
          <span className="update-banner__pct">{percent}%</span>
        </div>
        <div className="update-banner__track">
          <div className="update-banner__bar" style={{ width: `${percent}%` }} />
        </div>
      </div>
    )
  }

  if (update.state === 'downloaded' || update.state === 'manual-install') {
    // An unsigned macOS build can't be auto-installed; the user opens the
    // downloaded installer and drags it to Applications instead.
    const manual = update.state === 'manual-install'
    return (
      <div className="update-banner update-banner--ready" role="alert">
        <div className="update-banner__row">
          <span className="update-banner__title">
            GitGrove {update.newVersion} {manual ? 'has been downloaded.' : 'is ready to install.'}
          </span>
          <button className="update-banner__close" title="Later" onClick={onDismiss}>
            <Icon.Close size={13} />
          </button>
        </div>
        {manual && (
          <p className="update-banner__hint">
            Open the installer and drag GitGrove to your Applications folder to finish.
          </p>
        )}
        <div className="update-banner__actions">
          <button className="btn-primary btn-primary--sm" onClick={onInstall}>
            {manual ? 'Open Installer' : 'Restart & Install'}
          </button>
          <button className="btn-ghost btn-ghost--sm" onClick={onDismiss}>
            Later
          </button>
        </div>
      </div>
    )
  }

  return null
}
