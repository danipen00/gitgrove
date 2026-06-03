import type { UpdateStatus } from '@shared/types'
import { Icon } from '../lib/icons'

interface Props {
  update: UpdateStatus | null
  onInstall: () => void
  onDismiss: () => void
}

/**
 * Unobtrusive bottom-right card surfacing an in-progress or ready update. Quiet
 * states (checking / up-to-date / errors from background checks) are reflected
 * only in the About dialog; this banner appears once an update is actually
 * downloading or ready to install.
 */
export function UpdateBanner({ update, onInstall, onDismiss }: Props) {
  if (!update) return null

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

  if (update.state === 'downloaded') {
    return (
      <div className="update-banner update-banner--ready" role="alert">
        <div className="update-banner__row">
          <span className="update-banner__title">
            GitGrove {update.newVersion} is ready to install.
          </span>
          <button className="update-banner__close" title="Later" onClick={onDismiss}>
            <Icon.Close size={13} />
          </button>
        </div>
        <div className="update-banner__actions">
          <button className="btn-primary btn-primary--sm" onClick={onInstall}>
            Restart & Install
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
