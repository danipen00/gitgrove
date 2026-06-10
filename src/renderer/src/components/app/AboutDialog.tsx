import type { AppInfo, UpdateStatus } from '@shared/types'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/lib/icons'
import iconUrl from '../../assets/icon.svg'

interface Props {
  info: AppInfo | null
  update: UpdateStatus | null
  onClose: () => void
  onCheckForUpdates: () => void
  onInstall: () => void
}

/** Human-readable line describing the current update check, shown under the version. */
function updateLine(
  info: AppInfo,
  update: UpdateStatus | null
): { text: string; tone: 'muted' | 'accent' | 'error' } {
  if (info.dev) return { text: 'Updates are disabled in development builds.', tone: 'muted' }
  if (!update) return { text: `Version ${info.version}`, tone: 'muted' }
  switch (update.state) {
    case 'checking':
      return { text: 'Checking for updates…', tone: 'muted' }
    case 'available':
      return { text: `Downloading version ${update.newVersion}…`, tone: 'accent' }
    case 'downloading':
      return { text: `Downloading update… ${update.percent ?? 0}%`, tone: 'accent' }
    case 'downloaded':
      return { text: `Version ${update.newVersion} is ready to install.`, tone: 'accent' }
    case 'manual-install':
      return {
        text: `Version ${update.newVersion} downloaded — open the installer to finish.`,
        tone: 'accent'
      }
    case 'not-available':
      return { text: "You're on the latest version.", tone: 'muted' }
    case 'dev':
      return { text: 'Updates are disabled in development builds.', tone: 'muted' }
    case 'error':
      return {
        text: `Couldn't check for updates: ${update.error ?? 'unknown error'}`,
        tone: 'error'
      }
    default:
      return { text: `Version ${info.version}`, tone: 'muted' }
  }
}

export function AboutDialog({ info, update, onClose, onCheckForUpdates, onInstall }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!info) return null

  const line = updateLine(info, update)
  const checking = update?.state === 'checking'
  const downloaded = update?.state === 'downloaded'
  const manualInstall = update?.state === 'manual-install'

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal about"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal__close" title="Close" onClick={onClose}>
          <Icon.Close size={15} />
        </button>

        <img className="about__logo" src={iconUrl} width={84} height={84} alt="GitGrove" />
        <h2 className="about__name">{info.name}</h2>
        <div className="about__version">Version {info.version}</div>
        <p className="about__tagline">
          A fast, beautiful git client with diffs rendered by{' '}
          <a href="https://diffs.com/" target="_blank" rel="noreferrer">
            @pierre/diffs
          </a>
          .
        </p>

        <div className="about__update">
          <span className={`about__update-text is-${line.tone}`}>
            {checking && <span className="about__spinner" aria-hidden />}
            {line.text}
          </span>
          {downloaded || manualInstall ? (
            <button className="btn-primary btn-primary--sm" onClick={onInstall}>
              {manualInstall ? 'Open Installer' : 'Restart & Install'}
            </button>
          ) : (
            <button
              className="btn-ghost btn-ghost--sm"
              disabled={checking || info.dev}
              onClick={onCheckForUpdates}
            >
              <Icon.Refresh size={14} /> Check for Updates
            </button>
          )}
        </div>

        <dl className="about__meta">
          <div>
            <dt>Electron</dt>
            <dd>{info.electron}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{info.chrome}</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>{info.node}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>
              {info.platform} · {info.arch}
            </dd>
          </div>
        </dl>

        <div className="about__links">
          <a href={info.repoUrl} target="_blank" rel="noreferrer">
            <Icon.Tree size={14} /> View on GitHub
          </a>
          <a href={`${info.repoUrl}/issues/new`} target="_blank" rel="noreferrer">
            <Icon.Diff size={14} /> Report an Issue
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}
