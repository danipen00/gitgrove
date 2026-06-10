// Clone dialog: URL + destination folder, live progress from `git clone
// --progress`, and the new repo opens on success. Credentials come from the
// user's configured git credential helpers / SSH agent — git never prompts
// here, so a private repo without stored credentials fails with git's own
// message rather than hanging.

import type { CloneProgress } from '@shared/types'
import { useEffect, useState } from 'react'
import { prettyPath } from '../lib/format'
import { Icon } from '../lib/icons'
import { DialogShell } from './Dialog'

interface Props {
  onDone: (repoPath: string) => void
  onCancel: () => void
}

export function CloneDialog({ onDone, onCancel }: Props) {
  const [url, setUrl] = useState('')
  const [dir, setDir] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.gitgrove.onCloneProgress(setProgress), [])

  const pickDir = async () => {
    const picked = await window.gitgrove.pickDirectory('Clone into folder')
    if (picked) setDir(picked)
  }

  const start = async () => {
    if (!url.trim() || !dir || cloning) return
    setCloning(true)
    setError(null)
    setProgress(null)
    try {
      const repoPath = await window.gitgrove.cloneRepo(url.trim(), dir)
      onDone(repoPath)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCloning(false)
    }
  }

  return (
    <DialogShell
      title="Clone repository"
      icon={<Icon.Download size={22} />}
      busy={cloning}
      onClose={onCancel}
      width={480}
    >
      <div className="dlg-field">
        <label htmlFor="clone-url">Repository URL</label>
        <input
          id="clone-url"
          autoFocus
          placeholder="https://github.com/owner/repo.git or git@host:owner/repo.git"
          value={url}
          disabled={cloning}
          onChange={(e) => {
            setError(null)
            setUrl(e.target.value)
          }}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
      </div>
      <div className="dlg-field">
        <label htmlFor="clone-dir">Clone into</label>
        <div className="dlg-pickrow">
          <input
            id="clone-dir"
            readOnly
            placeholder="Choose a parent folder…"
            value={dir ? prettyPath(dir) : ''}
            onClick={pickDir}
          />
          <button className="btn-ghost btn-ghost--sm" onClick={pickDir} disabled={cloning}>
            <Icon.Folder size={14} /> Browse
          </button>
        </div>
      </div>

      {cloning && (
        <div className="clone-progress">
          <div className="clone-progress__bar">
            <div
              className="clone-progress__fill"
              style={{ width: `${Math.max(2, progress?.percent ?? 2)}%` }}
            />
          </div>
          <span className="clone-progress__label">
            {progress ? `${progress.phase}… ${progress.percent}%` : 'Starting clone…'}
          </span>
        </div>
      )}
      {error && <p className="dlg-error">{error}</p>}

      <div className="trust__actions">
        <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={cloning}>
          Cancel
        </button>
        <button
          className="btn-primary btn-primary--sm"
          onClick={start}
          disabled={cloning || !url.trim() || !dir}
        >
          {cloning && <span className="about__spinner" aria-hidden />}
          {cloning ? 'Cloning…' : 'Clone'}
        </button>
      </div>
    </DialogShell>
  )
}
