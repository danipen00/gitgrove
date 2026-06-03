import { useState } from 'react'
import { Icon } from '../lib/icons'

interface Props {
  /** Host platform, used to tailor the install guidance. Undefined while unknown. */
  platform: NodeJS.Platform | undefined
  /** True while a re-check is in flight. */
  checking: boolean
  /** Re-probe for git (after the user installs it). */
  onRecheck: () => void
}

const DOWNLOAD_URL = 'https://git-scm.com/downloads'

/** Platform-specific download label + an optional terminal install command. */
function guidance(platform: Props['platform']): {
  download: string
  cmd?: string
  cmdNote?: string
} {
  switch (platform) {
    case 'darwin':
      return {
        download: 'Download Git for macOS',
        cmd: 'brew install git',
        cmdNote: 'Prefer the terminal? With Homebrew installed:'
      }
    case 'linux':
      return {
        download: 'Git install instructions',
        cmd: 'sudo apt install git',
        cmdNote: 'On Debian / Ubuntu:'
      }
    default:
      return { download: 'Download Git for Windows' }
  }
}

/**
 * Full-screen onboarding shown when no usable git is found. Rather than letting
 * every repo action fail with a cryptic error, this guides the user to install
 * git, then re-checks without needing an app restart.
 */
export function GitSetup({ platform, checking, onRecheck }: Props) {
  const { download, cmd, cmdNote } = guidance(platform)
  const [copied, setCopied] = useState(false)

  const copyCmd = async () => {
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  return (
    <div className="welcome">
      <div className="welcome__card git-setup">
        <div className="git-setup__badge">
          <Icon.Branch size={30} />
        </div>
        <h1>Git is required</h1>
        <p>
          GitGrove reads repositories through the <code>git</code> command line, and it isn’t
          installed (or isn’t on your PATH) yet. Install Git, then re-check below — no restart
          needed.
        </p>

        <div className="git-setup__actions">
          <a className="btn-primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <Icon.Download size={16} /> {download}
          </a>
          <button className="btn-ghost" onClick={onRecheck} disabled={checking}>
            {checking ? (
              <span className="about__spinner" aria-hidden />
            ) : (
              <Icon.Refresh size={15} />
            )}
            {checking ? 'Checking…' : 'Re-check'}
          </button>
        </div>

        {cmd && (
          <div className="git-setup__cmd">
            <span className="git-setup__cmd-note">{cmdNote}</span>
            <div className="git-setup__cmd-row">
              <Icon.Terminal size={15} />
              <code>{cmd}</code>
              <button
                className={`copy-btn${copied ? ' is-copied' : ''}`}
                title={copied ? 'Copied' : 'Copy command'}
                onClick={copyCmd}
              >
                {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        <p className="git-setup__hint">
          Already use GitHub Desktop? Its bundled git works too — GitGrove will find it
          automatically on the next check.
        </p>
      </div>
    </div>
  )
}
