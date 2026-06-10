// Submodule overview: status of every submodule (clean / modified /
// uninitialized / conflict), open one as a repo, and a one-click
// `submodule update --init --recursive`.

import type { SubmoduleInfo } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { Icon } from '@/lib/icons'

interface Props {
  repoPath: string
  onOpenRepo: (path: string) => void
  onError: (e: unknown) => void
  onClose: () => void
}

const STATE_LABEL: Record<SubmoduleInfo['state'], string> = {
  clean: 'clean',
  modified: 'out of sync',
  uninitialized: 'not initialized',
  conflict: 'conflicted'
}

export function SubmodulesDialog({ repoPath, onOpenRepo, onError, onClose }: Props) {
  const [mods, setMods] = useState<SubmoduleInfo[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setMods(await window.gitgrove.submoduleList(repoPath))
    } catch (e) {
      onError(e)
      onClose()
    }
  }, [repoPath, onError, onClose])

  useEffect(() => {
    reload()
  }, [reload])

  const updateAll = async () => {
    setBusy(true)
    try {
      await window.gitgrove.submoduleUpdate(repoPath)
      await reload()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Submodules"
      icon={<Icon.Module size={22} />}
      busy={busy}
      onClose={onClose}
      width={520}
    >
      {mods === null ? (
        <div className="center-state" style={{ padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : mods.length === 0 ? (
        <p className="trust__body">This repository has no submodules.</p>
      ) : (
        <div className="wt-list">
          {mods.map((m) => (
            <div key={m.path} className="wt-item">
              <span className="icon-muted" style={{ display: 'flex' }}>
                <Icon.Module size={16} />
              </span>
              <div className="wt-item__main">
                <span className="wt-item__branch">{m.path}</span>
                <span className="wt-item__path">
                  @ {m.shaShort} ·{' '}
                  <span className={`submodule-state is-${m.state}`}>{STATE_LABEL[m.state]}</span>
                </span>
              </div>
              <div className="wt-item__actions">
                {m.state !== 'uninitialized' && (
                  <button
                    className="section-head__action"
                    disabled={busy}
                    data-tip="Open submodule in GitGrove"
                    onClick={() => {
                      onClose()
                      onOpenRepo(`${repoPath}/${m.path}`)
                    }}
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="trust__actions" style={{ justifyContent: 'space-between' }}>
        <button
          className="btn-ghost btn-ghost--sm"
          onClick={updateAll}
          disabled={busy || mods === null || mods.length === 0}
          data-tip="git submodule update --init --recursive"
        >
          {busy && <span className="about__spinner" aria-hidden />}
          Update all
        </button>
        <button className="btn-primary btn-primary--sm" onClick={onClose}>
          Done
        </button>
      </div>
    </DialogShell>
  )
}
