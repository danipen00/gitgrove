import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import type { BranchInfo, ChangedFile, Commit, DiffPayload, RepoSummary } from '@shared/types'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'
import { ChangesView } from './components/ChangesView'
import { HistoryView } from './components/HistoryView'
import { CommitSummary } from './components/CommitSummary'
import { TooltipLayer } from './components/TooltipLayer'
import { DiffViewer, type DiffMode } from './components/DiffViewer'
import { Resizer } from './components/Resizer'
import { Icon } from './lib/icons'
import { useTheme } from './lib/theme'

type Tab = 'changes' | 'history'

const LOG_LIMIT = 300

function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    },
    [key]
  )
  return [value, set]
}

export function App() {
  const [repo, setRepo] = useState<RepoSummary | null>(null)
  const [branch, setBranch] = useState<BranchInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('changes')

  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [changesLoading, setChangesLoading] = useState(false)
  const [changeSelPath, setChangeSelPath] = useState<string | null>(null)

  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null)
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([])
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)
  const [commitSelPath, setCommitSelPath] = useState<string | null>(null)

  const [diff, setDiff] = useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const diffReq = useRef(0)

  const [sidebarWidth, setSidebarWidth] = usePersistentState('gg.sidebarWidth', 340)
  // The sidebar width is driven by a CSS variable on `.app__body`. While dragging
  // the splitter we write the var straight to this node (see Resizer.onPreview),
  // so a resize never re-renders React — only the final size is committed to state.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [diffMode, setDiffMode] = usePersistentState<DiffMode>('gg.diffMode', 'split')
  const [diffWrap, setDiffWrap] = usePersistentState('gg.diffWrap', false)
  const { pref: themePref, resolved: theme, setPref: setThemePref } = useTheme()

  const repoRef = useRef<RepoSummary | null>(null)
  repoRef.current = repo
  // Refs so the filesystem-driven refresh can read the latest view without
  // being re-created (which would re-subscribe the watcher).
  const tabRef = useRef<Tab>(tab)
  tabRef.current = tab
  const changeSelRef = useRef<string | null>(changeSelPath)
  changeSelRef.current = changeSelPath

  const fail = useCallback((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    setError(message)
  }, [])

  // ── Data loaders ─────────────────────────────────────────────────────────
  const loadStatus = useCallback(async (repoPath: string) => {
    setChangesLoading(true)
    try {
      const files = await window.gitgrove.status(repoPath)
      setChanges(files)
      return files
    } finally {
      setChangesLoading(false)
    }
  }, [])

  const loadLog = useCallback(async (repoPath: string, ref?: string) => {
    setCommitsLoading(true)
    try {
      const log = await window.gitgrove.log(repoPath, { limit: LOG_LIMIT, ref })
      setCommits(log)
      return log
    } finally {
      setCommitsLoading(false)
    }
  }, [])

  const loadWorkingDiff = useCallback(async (file: ChangedFile) => {
    const repoPath = repoRef.current?.path
    if (!repoPath) return
    const id = ++diffReq.current
    setDiffLoading(true)
    try {
      const payload = await window.gitgrove.workingDiff(repoPath, file)
      if (id === diffReq.current) setDiff(payload)
    } catch (e) {
      if (id === diffReq.current) fail(e)
    } finally {
      if (id === diffReq.current) setDiffLoading(false)
    }
  }, [fail])

  const loadCommitDiff = useCallback(
    async (hash: string, file: ChangedFile) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return
      const id = ++diffReq.current
      setDiffLoading(true)
      try {
        const payload = await window.gitgrove.commitDiff(repoPath, hash, file)
        if (id === diffReq.current) setDiff(payload)
      } catch (e) {
        if (id === diffReq.current) fail(e)
      } finally {
        if (id === diffReq.current) setDiffLoading(false)
      }
    },
    [fail]
  )

  // ── Selection handlers ─────────────────────────────────────────────────────
  const selectChangeFile = useCallback(
    (path: string, list?: ChangedFile[]) => {
      const file = (list ?? changes).find((f) => f.path === path)
      if (!file) return
      setChangeSelPath(path)
      loadWorkingDiff(file)
    },
    [changes, loadWorkingDiff]
  )

  const selectCommitFile = useCallback(
    (path: string, hash: string, list?: ChangedFile[]) => {
      const file = (list ?? commitFiles).find((f) => f.path === path)
      if (!file) return
      setCommitSelPath(path)
      loadCommitDiff(hash, file)
    },
    [commitFiles, loadCommitDiff]
  )

  const selectCommit = useCallback(
    async (commit: Commit) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return
      setSelectedCommit(commit)
      setCommitSelPath(null)
      setCommitFiles([])
      setCommitFilesLoading(true)
      try {
        const files = await window.gitgrove.commitFiles(repoPath, commit.hash)
        setCommitFiles(files)
        if (files.length > 0) selectCommitFile(files[0].path, commit.hash, files)
        else {
          setDiff(null)
          diffReq.current++
        }
      } catch (e) {
        fail(e)
      } finally {
        setCommitFilesLoading(false)
      }
    },
    [fail, selectCommitFile]
  )

  // ── Tab switching keeps the right pane in sync with the active selection ───
  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next)
      if (next === 'changes') {
        if (changeSelPath) selectChangeFile(changeSelPath)
        else {
          setDiff(null)
          diffReq.current++
        }
      } else {
        if (selectedCommit && commitSelPath) selectCommitFile(commitSelPath, selectedCommit.hash)
        else {
          setDiff(null)
          diffReq.current++
        }
      }
    },
    [changeSelPath, commitSelPath, selectedCommit, selectChangeFile, selectCommitFile]
  )

  // ── Repository lifecycle ───────────────────────────────────────────────────
  const applyRepo = useCallback(
    async (summary: RepoSummary) => {
      setRepo(summary)
      setBranch(summary.branch)
      setSelectedCommit(null)
      setCommitFiles([])
      setCommitSelPath(null)
      setChangeSelPath(null)
      setDiff(null)
      diffReq.current++
      try {
        const [files] = await Promise.all([loadStatus(summary.path), loadLog(summary.path)])
        if (files.length > 0) {
          setTab('changes')
          selectChangeFile(files[0].path, files)
        } else {
          setTab('changes')
        }
      } catch (e) {
        fail(e)
      }
    },
    [loadStatus, loadLog, selectChangeFile, fail]
  )

  const pickRepo = useCallback(async () => {
    try {
      const summary = await window.gitgrove.pickRepo()
      if (summary) applyRepo(summary)
    } catch (e) {
      fail(e)
    }
  }, [applyRepo, fail])

  const openRepoByPath = useCallback(
    async (path: string) => {
      try {
        const summary = await window.gitgrove.openRepo(path)
        applyRepo(summary)
      } catch (e) {
        fail(e)
      }
    },
    [applyRepo, fail]
  )

  const checkout = useCallback(
    async (name: string) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return
      setBusy(true)
      try {
        const updated = await window.gitgrove.checkout(repoPath, name)
        setBranch(updated)
        setSelectedCommit(null)
        setCommitFiles([])
        setCommitSelPath(null)
        setChangeSelPath(null)
        setDiff(null)
        diffReq.current++
        const [files] = await Promise.all([loadStatus(repoPath), loadLog(repoPath)])
        if (files.length > 0) selectChangeFile(files[0].path, files)
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    },
    [loadStatus, loadLog, selectChangeFile, fail]
  )

  const refresh = useCallback(async () => {
    const repoPath = repoRef.current?.path
    if (!repoPath) return
    setRefreshing(true)
    try {
      const [files, , freshBranch] = await Promise.all([
        loadStatus(repoPath),
        loadLog(repoPath),
        window.gitgrove.branches(repoPath)
      ])
      setBranch(freshBranch)
      // Keep the working selection valid; only re-fetch its diff when the
      // Changes tab is actually showing it, so a background edit never clobbers
      // a commit diff the user is reading in History.
      const current = changeSelRef.current
      if (current && !files.some((f) => f.path === current)) {
        setChangeSelPath(null)
      } else if (current && tabRef.current === 'changes') {
        const file = files.find((f) => f.path === current)!
        loadWorkingDiff(file)
      }
    } catch (e) {
      fail(e)
    } finally {
      setRefreshing(false)
    }
  }, [loadStatus, loadLog, loadWorkingDiff, fail])

  // ── OS integration: menu command + filesystem change notifications ─────────
  useEffect(() => window.gitgrove.onMenuOpenRepo(() => pickRepo()), [pickRepo])

  useEffect(() => {
    return window.gitgrove.onRepoChanged((changedPath) => {
      if (repoRef.current && changedPath === repoRef.current.path) refresh()
    })
  }, [refresh])

  // auto-dismiss errors
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  if (!repo) {
    return (
      <div className="app">
        <Toolbar
          repo={null}
          branch={null}
          busy={false}
          refreshing={false}
          themePref={themePref}
          resolvedTheme={theme}
          onOpenRepo={openRepoByPath}
          onPickRepo={pickRepo}
          onCheckout={checkout}
          onRefresh={refresh}
          onThemeChange={setThemePref}
        />
        <div className="app__body">
          <Welcome onPickRepo={pickRepo} onOpenRepo={openRepoByPath} />
        </div>
        {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      </div>
    )
  }

  const selectedFilePath = tab === 'changes' ? changeSelPath : commitSelPath

  return (
    <div className="app">
      <Toolbar
        repo={repo}
        branch={branch}
        busy={busy}
        refreshing={refreshing}
        themePref={themePref}
        resolvedTheme={theme}
        onOpenRepo={openRepoByPath}
        onPickRepo={pickRepo}
        onCheckout={checkout}
        onRefresh={refresh}
        onThemeChange={setThemePref}
      />
      <div
        className="app__body"
        ref={bodyRef}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
      >
        <aside className="sidebar">
          <div className="sidebar__tabs">
            <button
              className={`tab${tab === 'changes' ? ' is-active' : ''}`}
              onClick={() => switchTab('changes')}
            >
              <Icon.Changes size={15} /> Changes
              {changes.length > 0 && <span className="tab__count">{changes.length}</span>}
            </button>
            <button
              className={`tab${tab === 'history' ? ' is-active' : ''}`}
              onClick={() => switchTab('history')}
            >
              <Icon.History size={15} /> History
            </button>
          </div>
          <div className="sidebar__body">
            {tab === 'changes' ? (
              <ChangesView
                changes={changes}
                loading={changesLoading}
                selectedFilePath={changeSelPath}
                onSelectFile={(p) => selectChangeFile(p)}
              />
            ) : (
              <HistoryView
                commits={commits}
                loading={commitsLoading}
                selectedCommit={selectedCommit}
                onSelectCommit={selectCommit}
                commitFiles={commitFiles}
                commitFilesLoading={commitFilesLoading}
                selectedFilePath={commitSelPath}
                onSelectFile={(p) =>
                  selectedCommit && selectCommitFile(p, selectedCommit.hash)
                }
              />
            )}
          </div>
        </aside>

        <Resizer
          orientation="x"
          size={sidebarWidth}
          min={220}
          max={620}
          onPreview={(w) => bodyRef.current?.style.setProperty('--sidebar-w', `${w}px`)}
          onCommit={setSidebarWidth}
        />

        <div className="workspace">
          {tab === 'history' && selectedCommit && (
            <CommitSummary
              key={selectedCommit.hash}
              commit={selectedCommit}
              files={commitFiles}
              filesLoading={commitFilesLoading}
            />
          )}
          <DiffViewer
            diff={diff}
            loading={diffLoading}
            mode={diffMode}
            wrap={diffWrap}
            theme={theme}
            onModeChange={setDiffMode}
            onWrapChange={setDiffWrap}
          />
        </div>
      </div>

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      <TooltipLayer />
    </div>
  )
}

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button onClick={onClose} title="Dismiss">
        <Icon.Close size={14} />
      </button>
    </div>
  )
}
