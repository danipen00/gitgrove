import type {
  AppInfo,
  BranchInfo,
  ChangedFile,
  Commit,
  DiffPayload,
  GitAvailability,
  RepoOpenResult,
  RepoSummary,
  UpdateStatus
} from '@shared/types'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { ChangesView } from './components/ChangesView'
import { CommitSummary } from './components/CommitSummary'
import { type DiffMode, DiffViewer } from './components/DiffViewer'
import { GitSetup } from './components/GitSetup'
import { HistoryView } from './components/HistoryView'
import { Resizer } from './components/Resizer'
import { Toolbar } from './components/Toolbar'
import { TooltipLayer } from './components/TooltipLayer'
import { TrustDialog } from './components/TrustDialog'
import { UpdateBanner } from './components/UpdateBanner'
import { Welcome } from './components/Welcome'
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
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Git availability gates the whole UI: null = checking, then a setup screen
  // when git is missing (see the render gate below).
  const [git, setGit] = useState<GitAvailability | null>(null)
  const [gitChecking, setGitChecking] = useState(false)

  // Path of a folder git flagged as untrusted ("dubious ownership"); set to show
  // the trust prompt, with `trusting` true while persisting the exception.
  const [trustPath, setTrustPath] = useState<string | null>(null)
  const [trusting, setTrusting] = useState(false)

  // App/about + auto-update state.
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Version the user dismissed the "ready to install" banner for, so it stays
  // hidden until a newer build arrives.
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('changes')

  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [changesLoading, setChangesLoading] = useState(false)
  const [changeSelPath, setChangeSelPath] = useState<string | null>(null)

  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  // History is loaded lazily the first time the tab is opened; this tracks
  // whether the current repo's log has been fetched so later refreshes only
  // re-fetch it when it's actually in use.
  const [logLoaded, setLogLoaded] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null)
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([])
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)
  const [commitSelPath, setCommitSelPath] = useState<string | null>(null)

  const [diff, setDiff] = useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const diffReq = useRef(0)
  // Like `diffReq`, but for commit selection: selecting a commit fires an async
  // `commitFiles` fetch, and a slow one can resolve after the user has already
  // picked another commit. This token lets a superseded selection bail out
  // instead of clobbering the current commit's files/diff with a torn state.
  const commitReq = useRef(0)

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
  const logLoadedRef = useRef(logLoaded)
  logLoadedRef.current = logLoaded

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

  const loadBranches = useCallback(async (repoPath: string) => {
    setBranchesLoading(true)
    try {
      const info = await window.gitgrove.branches(repoPath)
      setBranch(info)
      return info
    } finally {
      setBranchesLoading(false)
    }
  }, [])

  const loadLog = useCallback(async (repoPath: string, ref?: string) => {
    setCommitsLoading(true)
    try {
      const log = await window.gitgrove.log(repoPath, { limit: LOG_LIMIT, ref })
      setCommits(log)
      setLogLoaded(true)
      return log
    } finally {
      setCommitsLoading(false)
    }
  }, [])

  const loadWorkingDiff = useCallback(
    async (file: ChangedFile) => {
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
    },
    [fail]
  )

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
      const id = ++commitReq.current
      setSelectedCommit(commit)
      setCommitSelPath(null)
      setCommitFiles([])
      setCommitFilesLoading(true)
      try {
        const files = await window.gitgrove.commitFiles(repoPath, commit.hash)
        // A newer commit was selected while this one was loading — drop the
        // stale result so it can't overwrite the current commit's state.
        if (id !== commitReq.current) return
        setCommitFiles(files)
        if (files.length > 0) selectCommitFile(files[0].path, commit.hash, files)
        else {
          setDiff(null)
          diffReq.current++
        }
      } catch (e) {
        if (id === commitReq.current) fail(e)
      } finally {
        if (id === commitReq.current) setCommitFilesLoading(false)
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
        // First visit to History: fetch the log on demand.
        const repoPath = repoRef.current?.path
        if (repoPath && !logLoaded && !commitsLoading) loadLog(repoPath).catch(fail)
        if (selectedCommit && commitSelPath) selectCommitFile(commitSelPath, selectedCommit.hash)
        else {
          setDiff(null)
          diffReq.current++
        }
      }
    },
    [
      changeSelPath,
      commitSelPath,
      selectedCommit,
      logLoaded,
      commitsLoading,
      loadLog,
      selectChangeFile,
      selectCommitFile,
      fail
    ]
  )

  // ── Repository lifecycle ───────────────────────────────────────────────────
  const applyRepo = useCallback(
    async (summary: RepoSummary) => {
      // `summary` carries only the current branch name (a cheap open); the full
      // branch list and status are fetched here so the repo switch itself is
      // instant and each panel shows its own progress.
      setRepo(summary)
      setBranch(summary.branch)
      // Clear the previous repo's lists so the panels show their loading state
      // instead of stale entries while the new repo's data loads.
      setChanges([])
      setCommits([])
      setLogLoaded(false)
      setSelectedCommit(null)
      setCommitFiles([])
      setCommitSelPath(null)
      setChangeSelPath(null)
      setDiff(null)
      setTab('changes')
      diffReq.current++
      // Branch enumeration is the slowest part on big repos; let it fill in the
      // combo on its own so it never gates the first diff appearing. The log is
      // loaded lazily when the History tab is first opened (see switchTab).
      loadBranches(summary.path).catch(fail)
      try {
        const files = await loadStatus(summary.path)
        // Status can resolve after the user has already moved to History; in
        // that case just remember the selection (switchTab loads its diff on
        // return) rather than displaying it behind the History view.
        if (files.length > 0) {
          if (tabRef.current === 'changes') selectChangeFile(files[0].path, files)
          else setChangeSelPath(files[0].path)
        }
      } catch (e) {
        fail(e)
      }
    },
    [loadStatus, loadBranches, selectChangeFile, fail]
  )

  // Route an open outcome: success applies the repo, an untrusted folder opens
  // the trust prompt, and a non-repo surfaces the familiar error.
  const handleOpen = useCallback(
    (res: RepoOpenResult) => {
      if (res.ok) applyRepo(res.summary)
      else if (res.reason === 'untrusted') setTrustPath(res.path)
      else setError('The selected folder is not a git repository.')
    },
    [applyRepo]
  )

  const pickRepo = useCallback(async () => {
    try {
      const res = await window.gitgrove.pickRepo()
      if (res) handleOpen(res)
    } catch (e) {
      fail(e)
    }
  }, [handleOpen, fail])

  const openRepoByPath = useCallback(
    async (path: string) => {
      try {
        handleOpen(await window.gitgrove.openRepo(path))
      } catch (e) {
        fail(e)
      }
    },
    [handleOpen, fail]
  )

  const confirmTrust = useCallback(async () => {
    if (!trustPath) return
    setTrusting(true)
    try {
      const res = await window.gitgrove.trustRepo(trustPath)
      setTrustPath(null)
      handleOpen(res)
    } catch (e) {
      setTrustPath(null)
      fail(e)
    } finally {
      setTrusting(false)
    }
  }, [trustPath, handleOpen, fail])

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
        setCommits([])
        setLogLoaded(false)
        setDiff(null)
        diffReq.current++
        // The new branch invalidates the log; reload it now only if History is
        // showing, otherwise leave it for the next time the tab is opened.
        if (tabRef.current === 'history') loadLog(repoPath).catch(fail)
        const files = await loadStatus(repoPath)
        // Don't pull the diff pane onto a working file if the user is viewing
        // History; just keep the selection for when they return to Changes.
        if (files.length > 0) {
          if (tabRef.current === 'changes') selectChangeFile(files[0].path, files)
          else setChangeSelPath(files[0].path)
        }
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
        // Only refresh the log if it's already been loaded; no point fetching
        // history for a repo the user has only viewed in the Changes tab.
        logLoadedRef.current ? loadLog(repoPath) : Promise.resolve(null),
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

  // ── Git availability: probe on launch, re-probe on demand ──────────────────
  useEffect(() => {
    window.gitgrove
      .checkGit()
      .then(setGit)
      .catch(() => setGit({ available: false, platform: 'win32' }))
  }, [])

  const recheckGit = useCallback(async () => {
    setGitChecking(true)
    try {
      setGit(await window.gitgrove.checkGit(true))
    } finally {
      setGitChecking(false)
    }
  }, [])

  // ── OS integration: menu command + filesystem change notifications ─────────
  useEffect(() => window.gitgrove.onMenuOpenRepo(() => pickRepo()), [pickRepo])

  useEffect(() => {
    return window.gitgrove.onRepoChanged((changedPath) => {
      if (repoRef.current && changedPath === repoRef.current.path) refresh()
    })
  }, [refresh])

  // ── About dialog + auto-update ─────────────────────────────────────────────
  useEffect(() => {
    window.gitgrove
      .appInfo()
      .then(setAppInfo)
      .catch(() => {})
  }, [])

  useEffect(() => window.gitgrove.onShowAbout(() => setAboutOpen(true)), [])

  useEffect(
    () =>
      window.gitgrove.onUpdateStatus((status) => {
        setUpdate(status)
        // A freshly downloaded build clears any earlier "Later" dismissal.
        if (
          (status.state === 'downloaded' || status.state === 'manual-install') &&
          status.newVersion !== dismissedUpdate
        ) {
          setDismissedUpdate(null)
        }
      }),
    [dismissedUpdate]
  )

  const checkForUpdates = useCallback(() => {
    window.gitgrove.checkForUpdates(true).catch(fail)
  }, [fail])

  const installUpdate = useCallback(() => {
    window.gitgrove.installUpdate().catch(fail)
  }, [fail])

  // auto-dismiss errors
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  // Surface update progress unless the user dismissed the ready-to-install card.
  const bannerUpdate =
    update &&
    (update.state === 'downloading' ||
      update.state === 'available' ||
      ((update.state === 'downloaded' || update.state === 'manual-install') &&
        update.newVersion !== dismissedUpdate))
      ? update
      : null

  const overlays = (
    <>
      <UpdateBanner
        update={bannerUpdate}
        onInstall={installUpdate}
        onDismiss={() => setDismissedUpdate(update?.newVersion ?? null)}
      />
      {trustPath && (
        <TrustDialog
          path={trustPath}
          busy={trusting}
          onTrust={confirmTrust}
          onCancel={() => setTrustPath(null)}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          info={appInfo}
          update={update}
          onClose={() => setAboutOpen(false)}
          onCheckForUpdates={checkForUpdates}
          onInstall={installUpdate}
        />
      )}
    </>
  )

  // Gate the app on git: a brief splash while the (fast) check runs, then a
  // guided setup screen if git is missing — so repo actions that can't possibly
  // work are never offered.
  if (git === null || !git.available) {
    return (
      <div className="app">
        <Toolbar
          repo={null}
          branch={null}
          branchesLoading={false}
          busy={false}
          refreshing={false}
          themePref={themePref}
          resolvedTheme={theme}
          onOpenRepo={openRepoByPath}
          onPickRepo={pickRepo}
          onCheckout={checkout}
          onRefresh={refresh}
          onThemeChange={setThemePref}
          onAbout={() => setAboutOpen(true)}
        />
        <div className="app__body">
          {git === null ? (
            <div className="welcome">
              <div className="spinner" />
            </div>
          ) : (
            <GitSetup platform={git.platform} checking={gitChecking} onRecheck={recheckGit} />
          )}
        </div>
        {error && <ErrorToast message={error} onClose={() => setError(null)} />}
        {overlays}
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="app">
        <Toolbar
          repo={null}
          branch={null}
          branchesLoading={false}
          busy={false}
          refreshing={false}
          themePref={themePref}
          resolvedTheme={theme}
          onOpenRepo={openRepoByPath}
          onPickRepo={pickRepo}
          onCheckout={checkout}
          onRefresh={refresh}
          onThemeChange={setThemePref}
          onAbout={() => setAboutOpen(true)}
        />
        <div className="app__body">
          <Welcome onPickRepo={pickRepo} onOpenRepo={openRepoByPath} />
        </div>
        {error && <ErrorToast message={error} onClose={() => setError(null)} />}
        {overlays}
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repo={repo}
        branch={branch}
        branchesLoading={branchesLoading}
        busy={busy}
        refreshing={refreshing}
        themePref={themePref}
        resolvedTheme={theme}
        onOpenRepo={openRepoByPath}
        onPickRepo={pickRepo}
        onCheckout={checkout}
        onRefresh={refresh}
        onThemeChange={setThemePref}
        onAbout={() => setAboutOpen(true)}
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
                onSelectFile={(p) => selectedCommit && selectCommitFile(p, selectedCommit.hash)}
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
      {overlays}
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
