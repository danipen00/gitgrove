import { useEffect, useMemo, useRef } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'

import type { ChangedFile, FileStatus } from '@shared/types'

// @pierre/trees understands this subset of git statuses.
type TreeGitStatus = 'added' | 'deleted' | 'ignored' | 'modified' | 'renamed' | 'untracked'

function toTreeStatus(status: FileStatus): TreeGitStatus {
  switch (status) {
    case 'added':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'untracked':
      return 'untracked'
    case 'ignored':
      return 'ignored'
    case 'conflicted':
    case 'modified':
    default:
      return 'modified'
  }
}

/** Every ancestor directory of the given files, so the tree can stay expanded. */
function ancestorDirs(paths: string[]): string[] {
  const dirs = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }
  return [...dirs]
}

interface Props {
  files: ChangedFile[]
  selectedPath: string | null
  onSelectFile: (path: string) => void
}

/**
 * Renders a @pierre/trees FileTree for a set of changed files, with git-status
 * coloring and single-click file selection. Updates the underlying model in
 * place when the file set changes so search/scroll state is preserved.
 */
export function FileTreeView({ files, selectedPath, onSelectFile }: Props) {
  // @pierre/trees throws if any path repeats, which (with no error boundary)
  // blanks the whole window. Drop duplicates here so a malformed file list
  // degrades gracefully no matter where it came from.
  const uniqueFiles = useMemo(() => {
    const seen = new Set<string>()
    return files.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)))
  }, [files])
  const paths = useMemo(() => uniqueFiles.map((f) => f.path), [uniqueFiles])
  const gitStatus = useMemo(
    () => uniqueFiles.map((f) => ({ path: f.path, status: toTreeStatus(f.status) })),
    [uniqueFiles]
  )
  const expandedDirs = useMemo(() => ancestorDirs(paths), [paths])
  const fileSet = useMemo(() => new Set(paths), [paths])

  // Refs keep the (once-created) model's selection callback reading fresh state.
  const fileSetRef = useRef(fileSet)
  fileSetRef.current = fileSet
  const selRef = useRef(selectedPath)
  selRef.current = selectedPath
  const onSelectRef = useRef(onSelectFile)
  onSelectRef.current = onSelectFile

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: 'open',
    search: true,
    initialSelectedPaths: selectedPath ? [selectedPath] : undefined,
    onSelectionChange: (selected) => {
      const picked = selected.find((p) => fileSetRef.current.has(p))
      if (picked && picked !== selRef.current) onSelectRef.current(picked)
    }
  })

  // Sync the file set into the existing model (skip the very first run — the
  // model was just created with these paths).
  const initialised = useRef(false)
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      return
    }
    model.resetPaths(paths, { initialExpandedPaths: expandedDirs })
    model.setGitStatus(gitStatus)
    if (selRef.current && fileSetRef.current.has(selRef.current)) {
      model.getItem(selRef.current)?.select()
    }
  }, [model, paths, gitStatus, expandedDirs])

  // Reflect externally-driven selection (e.g. auto-select first file).
  useEffect(() => {
    if (!selectedPath || !fileSet.has(selectedPath)) return
    if (model.getSelectedPaths()[0] !== selectedPath) {
      model.getItem(selectedPath)?.select()
    }
  }, [model, selectedPath, fileSet])

  return <FileTree model={model} style={{ height: '100%' }} />
}
