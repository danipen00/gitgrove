import { useMemo } from 'react'
import { PatchDiff, MultiFileDiff } from '@pierre/diffs/react'
import type { BaseDiffOptions } from '@pierre/diffs/react'

import type { DiffPayload } from '@shared/types'
import { Icon } from '../lib/icons'
import type { ResolvedTheme } from '../lib/theme'
import { splitPath, statusLabel } from '../lib/format'

export type DiffMode = 'split' | 'unified'

interface Props {
  diff: DiffPayload | null
  loading: boolean
  mode: DiffMode
  wrap: boolean
  theme: ResolvedTheme
  onModeChange: (mode: DiffMode) => void
  onWrapChange: (wrap: boolean) => void
}

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

export function DiffViewer({ diff, loading, mode, wrap, theme, onModeChange, onWrapChange }: Props) {
  const stats = useMemo(() => (diff?.patch ? countChanges(diff.patch) : null), [diff?.patch])

  if (!diff && !loading) {
    return (
      <div className="diff-pane">
        <div className="center-state">
          <div className="icon-ring">
            <Icon.Diff size={24} />
          </div>
          <h3>No file selected</h3>
          <p>Pick a file from the Changes or History panel to see its diff here.</p>
        </div>
      </div>
    )
  }

  const { dir, name } = diff ? splitPath(diff.path) : { dir: '', name: '' }

  const diffOptions = {
    theme: theme === 'light' ? 'pierre-light' : 'pierre-dark',
    themeType: theme,
    diffStyle: mode,
    overflow: wrap ? 'wrap' : 'scroll',
    diffIndicators: 'bars',
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word',
    disableFileHeader: true,
    stickyHeader: false
  } satisfies BaseDiffOptions

  // Full file contents let us render an expandable diff (MultiFileDiff); without
  // them (binary / too large / unreadable) we fall back to the patch-only view.
  const canExpand = diff?.oldContents != null && diff?.newContents != null

  return (
    <div className="diff-pane">
      <div className="diff-head">
        {diff && (
          <>
            <div className="diff-head__path" title={diff.path}>
              <span className={`dot dot--${diff.status}`} />
              {dir && <span className="diff-head__dir">{dir}</span>}
              <span className="diff-head__name">{name}</span>
            </div>
            {diff.oldPath && (
              <span className="diff-head__dir" title={`renamed from ${diff.oldPath}`}>
                ← {splitPath(diff.oldPath).name}
              </span>
            )}
          </>
        )}
        <div className="diff-head__spacer" />
        {stats && (stats.additions > 0 || stats.deletions > 0) && (
          <span className="diff-stat">
            <span className="diff-stat__add">+{stats.additions}</span>
            <span className="diff-stat__del">−{stats.deletions}</span>
          </span>
        )}
        <button
          className={`icon-btn${wrap ? ' is-active' : ''}`}
          title="Toggle line wrapping"
          onClick={() => onWrapChange(!wrap)}
        >
          <Icon.Wrap size={16} />
        </button>
        <div className="segmented">
          <button
            className={mode === 'split' ? 'is-active' : ''}
            onClick={() => onModeChange('split')}
            title="Split view"
          >
            <Icon.Split size={15} /> Split
          </button>
          <button
            className={mode === 'unified' ? 'is-active' : ''}
            onClick={() => onModeChange('unified')}
            title="Unified view"
          >
            <Icon.Unified size={15} /> Unified
          </button>
        </div>
      </div>

      <div className="diff-body">
        {loading && (
          <div className="center-state">
            <div className="spinner" />
          </div>
        )}
        {!loading && diff && diff.notice && (
          <div className="center-state">
            <div className="icon-ring">
              <Icon.Diff size={22} />
            </div>
            <h3>{statusLabel(diff.status)}</h3>
            <p>{diff.notice}</p>
          </div>
        )}
        {!loading && diff && !diff.notice && diff.patch && canExpand && (
          <MultiFileDiff
            key={`${diff.path}:${theme}`}
            oldFile={{ name: diff.oldPath ?? diff.path, contents: diff.oldContents! }}
            newFile={{ name: diff.path, contents: diff.newContents! }}
            disableWorkerPool
            options={diffOptions}
            style={{ minHeight: '100%' }}
          />
        )}
        {!loading && diff && !diff.notice && diff.patch && !canExpand && (
          <PatchDiff
            key={`${diff.path}:${theme}`}
            patch={diff.patch}
            disableWorkerPool
            options={diffOptions}
            style={{ minHeight: '100%' }}
          />
        )}
        {!loading && diff && !diff.notice && !diff.patch && (
          <div className="center-state">
            <div className="icon-ring">
              <Icon.Check size={22} />
            </div>
            <h3>No changes</h3>
            <p>This file has no textual differences to display.</p>
          </div>
        )}
      </div>
    </div>
  )
}
