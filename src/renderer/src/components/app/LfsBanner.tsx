import type { LfsHealth } from '@shared/types'
import { Icon } from '@/lib/icons'

interface Props {
  health: LfsHealth
  /** True while `git lfs install` runs. */
  enabling: boolean
  /** One-click fix: run `git lfs install` and re-probe. */
  onEnable: () => void
  /** Re-probe health (after the user installed the binary themselves). */
  onRecheck: () => void
  onDismiss: () => void
}

/**
 * Bottom-right card shown when the open repo tracks files with Git LFS but
 * this machine can't run it — missing `git-lfs` binary, or missing
 * smudge/clean filter config. Without either, files quietly materialize as
 * pointer text and pushes drop content, and git never says a word. The fix is
 * one click (or one install link); no terminal, no jargon.
 */
export function LfsBanner({ health, enabling, onEnable, onRecheck, onDismiss }: Props) {
  const missingBinary = !health.binaryAvailable
  return (
    <div className="update-banner" role="alert">
      <div className="update-banner__row">
        <span className="update-banner__icon update-banner__icon--warn" aria-hidden>
          <Icon.Alert size={15} />
        </span>
        <span className="update-banner__title">
          {missingBinary ? 'This repository needs Git LFS' : 'Git LFS isn’t set up yet'}
        </span>
        <button className="update-banner__close" title="Dismiss" onClick={onDismiss}>
          <Icon.Close size={13} />
        </button>
      </div>
      <p className="update-banner__hint">
        {missingBinary
          ? 'Files here are tracked with Git LFS, but the git-lfs tool isn’t installed. ' +
            'Until it is, large files appear as small placeholder text.'
          : 'Files here are tracked with Git LFS. One click configures it so large files ' +
            'download and upload correctly.'}
      </p>
      <div className="update-banner__actions">
        {missingBinary ? (
          <>
            <button
              className="btn-primary btn-primary--sm"
              onClick={() => window.gitgrove.openExternal('https://git-lfs.com')}
            >
              Get Git LFS
            </button>
            <button className="btn-ghost btn-ghost--sm" onClick={onRecheck}>
              Check Again
            </button>
          </>
        ) : (
          <button className="btn-primary btn-primary--sm" disabled={enabling} onClick={onEnable}>
            {enabling ? 'Setting up…' : 'Set Up Git LFS'}
          </button>
        )}
      </div>
    </div>
  )
}
