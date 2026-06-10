import type { MenuCommand } from '@shared/ipc'
import type {
  AppInfo,
  BranchInfo,
  ChangedFile,
  Commit,
  DiffPayload,
  GitAvailability,
  RepoOpenResult,
  RepoSnapshot,
  RepoState,
  RepoSummary,
  ResetMode,
  StashEntry,
  SyncStatus,
  UpdateStatus
} from '@shared/types'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { usePersistentState } from './lib/persist'
import { ChangesView } from './components/ChangesView'
import { CloneDialog } from './components/CloneDialog'
import { CommitSummary } from './components/CommitSummary'
import type { ContextMenuItem } from './components/ContextMenu'
import { ConfirmDialog, PromptDialog, validateRefName } from './components/Dialog'
import { type DiffMode, DiffViewer, type FileSelection } from './components/DiffViewer'
import { GitSetup } from './components/GitSetup'
import { HistoryView } from './components/HistoryView'
import { InteractiveRebaseDialog } from './components/InteractiveRebaseDialog'
import { Resizer } from './components/Resizer'
import { SubmodulesDialog } from './components/SubmodulesDialog'
import type { BranchAction } from './components/BranchSwitcher'
import type { SyncAction } from './components/SyncButton'
import { Toolbar } from './components/Toolbar'
import { TooltipLayer } from './components/TooltipLayer'
import { TrustDialog } from './components/TrustDialog'
import { UpdateBanner } from './components/UpdateBanner'
import { Welcome } from './components/Welcome'
import { WorktreesDialog } from './components/WorktreesDialog'
import { Icon } from './lib/icons'
import { useTheme } from './lib/theme'

type Tab = 'changes' | 'history'

const LOG_LIMIT = 300
/** Background fetch cadence (ms) — quiet, skipped while an op runs. */
const AUTO_FETCH_INTERVAL = 10 * 60 * 1000

/** App-level modal dialogs (branch/tag/reset/rebase/clone/worktrees/…). */
type Modal =
  | { kind: 'clone' }
  | { kind: 'new-branch'; from?: string; fromLabel?: string; initialName?: string }
  | { kind: 'rename-branch'; name: string }
  | { kind: 'delete-branch'; name: string; force: boolean }
  | { kind: 'create-tag'; hash: string; shortHash: string }
  | { kind: 'reset'; hash: string; shortHash: string; mode: ResetMode }
  | { kind: 'revert'; hash: string; shortHash: string }
  | { kind: 'checkout-commit'; hash: string; shortHash: string }
  | { kind: 'irebase'; commits: Commit[]; base: string }
  | { kind: 'worktrees' }
  | { kind: 'submodules' }
  | { kind: 'stash' }

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
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  const [updateFeedbackDismissed, setUpdateFeedbackDismissed] = useState(false)

  const [tab, setTab] = useState<Tab>('changes')

  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [changesLoading, setChangesLoading] = useState(false)
  // Selected working file (repo-relative path).
  const [changeSel, setChangeSel] = useState<string | null>(null)

  // Write-side repo state: in-progress op, upstream tracking, stashes.
  const [repoState, setRepoState] = useState<RepoState | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [syncRunning, setSyncRunning] = useState<SyncAction | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [modalBusy, setModalBusy] = useState(false)

  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
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
  // picked another commit. This token lets a superseded selection bail out.
  const commitReq = useRef(0)

  const [sidebarWidth, setSidebarWidth] = usePersistentState('gg.sidebarWidth', 340)
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
  const changeSelRef = useRef<string | null>(changeSel)
  changeSelRef.current = changeSel
  const changesRef = useRef<ChangedFile[]>(changes)
  changesRef.current = changes
  const logLoadedRef = useRef(logLoaded)
  logLoadedRef.current = logLoaded
  const branchRef = useRef<BranchInfo | null>(branch)
  branchRef.current = branch
  const syncRef = useRef<SyncStatus | null>(sync)
  syncRef.current = sync
  const busyRef = useRef(busy)
  busyRef.current = busy
  const branchesLoadingRef = useRef(false)
  // Refresh coalescing: one in flight at a time; triggers that arrive while it
  // runs collapse into a single trailing run (watcher + focus + post-op can
  // otherwise stack three status passes on big repos).
  const refreshInFlight = useRef(false)
  const refreshQueued = useRef(false)
  // The commit selection (GitHub Desktop model): checkboxes are pure renderer
  // state — every changed file defaults to included; toggling never touches
  // git. Missing key = 'all'; 'none' = excluded; a Map = selected hunk
  // indexes with their commit patches.
  const [selections, setSelections] = useState<Map<string, FileSelection>>(new Map())

  const fail = useCallback((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    setError(message)
  }, [])

  // ── Data loaders ─────────────────────────────────────────────────────────
  // One IPC round-trip refreshes everything the sidebar shows: files, current
  // branch, ahead/behind, op state and stashes (a single `git status
  // --porcelain=2 --branch` plus config/reflog reads in the main process).
  // This is what keeps refreshes usable on 90k-file repositories.
  const applySnapshot = useCallback((snap: RepoSnapshot): ChangedFile[] => {
    setChanges(snap.files)
    setRepoState(snap.state)
    setSync({
      upstream: snap.upstream,
      ahead: snap.ahead,
      behind: snap.behind,
      remotes: snap.remotes
    })
    setStashes(snap.stashes)
    // Keep the displayed branch fresh without enumerating all branches — the
    // full list is loaded lazily when the switcher opens.
    setBranch((prev) =>
      prev
        ? { ...prev, current: snap.branch, detached: snap.detached }
        : { current: snap.branch, detached: snap.detached, local: [], remote: [] }
    )
    return snap.files
  }, [])

  const loadSnapshot = useCallback(
    async (repoPath: string) =>
      applySnapshot(JSON.parse(await window.gitgrove.snapshot(repoPath)) as RepoSnapshot),
    [applySnapshot]
  )

  const loadBranches = useCallback(async (repoPath: string) => {
    if (branchesLoadingRef.current) return null
    branchesLoadingRef.current = true
    setBranchesLoading(true)
    try {
      const info = await window.gitgrove.branches(repoPath)
      setBranch(info)
      return info
    } finally {
      branchesLoadingRef.current = false
      setBranchesLoading(false)
    }
  }, [])

  /** Lazy branch enumeration: runs when the switcher opens, never on refresh. */
  const reloadBranches = useCallback(() => {
    const repoPath = repoRef.current?.path
    if (repoPath) loadBranches(repoPath)?.catch(() => {})
  }, [loadBranches])

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
  const selectWorkingFile = useCallback(
    (path: string, list?: ChangedFile[]) => {
      const file = (list ?? changes).find((f) => f.path === path)
      if (!file) return
      setChangeSel(path)
      loadWorkingDiff(file)
    },
    [changes, loadWorkingDiff]
  )

  /** Default selection: the first file (the snapshot arrives path-sorted). */
  const autoSelect = useCallback(
    (files: ChangedFile[], applyDiff: boolean) => {
      const first = files[0]
      if (!first) {
        setChangeSel(null)
        return
      }
      if (applyDiff) selectWorkingFile(first.path, files)
      else setChangeSel(first.path)
    },
    [selectWorkingFile]
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
        if (changeSel) selectWorkingFile(changeSel)
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
      changeSel,
      commitSelPath,
      selectedCommit,
      logLoaded,
      commitsLoading,
      loadLog,
      selectWorkingFile,
      selectCommitFile,
      fail
    ]
  )

  // ── Refresh: pulls every panel up to date (watcher + post-op) ─────────────
  const refresh = useCallback(async () => {
    const repoPath = repoRef.current?.path
    if (!repoPath) return
    if (refreshInFlight.current) {
      refreshQueued.current = true
      return
    }
    refreshInFlight.current = true
    setRefreshing(true)
    try {
      // Refresh the log only while History is actually visible; otherwise just
      // mark it stale so the next visit refetches. Branch enumeration is NOT
      // part of a refresh — the switcher reloads it lazily when opened.
      const refreshLog = logLoadedRef.current && tabRef.current === 'history'
      if (logLoadedRef.current && !refreshLog) setLogLoaded(false)
      const [files] = await Promise.all([
        loadSnapshot(repoPath),
        refreshLog ? loadLog(repoPath) : Promise.resolve(null)
      ])
      // Keep the working selection valid; only re-fetch its diff when the
      // Changes tab is actually showing it, so a background edit never clobbers
      // a commit diff the user is reading in History.
      const current = changeSelRef.current
      const stillThere = current ? files.find((f) => f.path === current) : undefined
      if (current && !stillThere) {
        autoSelect(files, tabRef.current === 'changes')
      } else if (stillThere && tabRef.current === 'changes') {
        loadWorkingDiff(stillThere)
      }
    } catch (e) {
      fail(e)
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
      if (refreshQueued.current) {
        refreshQueued.current = false
        refreshRef.current()
      }
    }
  }, [loadSnapshot, loadLog, loadWorkingDiff, autoSelect, fail])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  /**
   * Run a mutating git operation: serialized behind `busy`, refreshed on
   * completion, errors surfaced as the standard toast. Resolves true on
   * success so callers can chain selection updates.
   */
  const runOp = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      if (busyRef.current) return false
      setBusy(true)
      try {
        await fn()
        await refreshRef.current()
        return true
      } catch (e) {
        fail(e)
        // The op may have half-applied (e.g. merge stopped on conflicts) —
        // refresh anyway so the UI shows the real state, banner included.
        await refreshRef.current().catch(() => {})
        return false
      } finally {
        setBusy(false)
      }
    },
    [fail]
  )

  // ── Repository lifecycle ───────────────────────────────────────────────────
  const applyRepo = useCallback(
    async (summary: RepoSummary) => {
      // `summary` carries only the current branch name (a cheap open); the full
      // branch list and status are fetched here so the repo switch itself is
      // instant and each panel shows its own progress.
      setRepo(summary)
      setBranch(summary.branch)
      setChanges([])
      setCommits([])
      setLogLoaded(false)
      setSelectedCommit(null)
      setCommitFiles([])
      setCommitSelPath(null)
      setChangeSel(null)
      setSelections(new Map())
      setDiff(null)
      setRepoState(null)
      setSync(null)
      setStashes([])
      setModal(null)
      setTab('changes')
      diffReq.current++
      // Branch enumeration is the slowest part on big repos; let it fill in the
      // combo on its own so it never gates the first diff appearing.
      loadBranches(summary.path).catch(fail)
      setChangesLoading(true)
      try {
        const files = await loadSnapshot(summary.path)
        if (files.length > 0) autoSelect(files, tabRef.current === 'changes')
      } catch (e) {
        fail(e)
      } finally {
        setChangesLoading(false)
      }
    },
    [loadSnapshot, loadBranches, autoSelect, fail]
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
        setChangeSel(null)
        setSelections(new Map())
        setCommits([])
        setLogLoaded(false)
        setDiff(null)
        diffReq.current++
        // The new branch invalidates the log; reload it now only if History is
        // showing, otherwise leave it for the next time the tab is opened.
        if (tabRef.current === 'history') loadLog(repoPath).catch(fail)
        const files = await loadSnapshot(repoPath)
        if (files.length > 0) autoSelect(files, tabRef.current === 'changes')
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    },
    [loadSnapshot, loadLog, autoSelect, fail]
  )

  // ── Commit, hunks, sync, branch & history actions ──────────────────────────
  const doCommit = useCallback(
    async (message: string, amend: boolean) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return false
      // Assemble the checkbox selection into one commit payload: fully
      // included paths plus standalone patches for partially included files.
      const paths: string[] = []
      const patches: string[] = []
      let all = true
      for (const f of changesRef.current) {
        if (f.status === 'conflicted') {
          all = false
          continue
        }
        const sel = selections.get(f.path) ?? 'all'
        if (sel === 'all') {
          paths.push(f.path)
        } else {
          all = false
          if (sel !== 'none') patches.push(...sel.values())
        }
      }
      const ok = await runOp(() =>
        window.gitgrove.commit(repoPath, message, {
          amend,
          all,
          paths: all ? [] : paths,
          patches
        })
      )
      if (ok) setSelections(new Map())
      return ok
    },
    [runOp, selections]
  )

  /**
   * Stash the checked files (stash granularity is the file — partially
   * included files are stashed whole). When everything is checked, plain
   * `git stash push -u` runs with no pathspec; otherwise the checked paths
   * stream to git over stdin, untracked included.
   */
  const doStash = useCallback(
    async (message: string) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return false
      const paths: string[] = []
      let all = true
      for (const f of changesRef.current) {
        if (f.status === 'conflicted') {
          all = false
          continue
        }
        if ((selections.get(f.path) ?? 'all') === 'none') all = false
        else paths.push(f.path)
      }
      if (paths.length === 0) return false
      const ok = await runOp(() =>
        window.gitgrove.stashSave(repoPath, {
          message,
          includeUntracked: true,
          paths: all ? undefined : paths
        })
      )
      if (ok) setSelections(new Map())
      return ok
    },
    [runOp, selections]
  )

  // ── Commit selection (pure renderer state, zero git) ──────────────────────
  /** Toggle a file's checkbox: indeterminate/unchecked → included, checked → excluded. */
  const toggleFileIncluded = useCallback((path: string) => {
    setSelections((prev) => {
      const next = new Map(prev)
      const cur = prev.get(path) ?? 'all'
      if (cur === 'all') next.set(path, 'none')
      else next.delete(path) // 'none' or partial → fully included
      return next
    })
  }, [])

  /** Master checkbox: include/exclude every file, or just `paths` when filtering. */
  const setAllIncluded = useCallback((included: boolean, paths?: string[]) => {
    if (!paths) {
      setSelections(
        included
          ? new Map()
          : new Map(changesRef.current.map((f) => [f.path, 'none' as FileSelection]))
      )
      return
    }
    setSelections((prev) => {
      const next = new Map(prev)
      for (const p of paths) {
        if (included) next.delete(p)
        else next.set(p, 'none')
      }
      return next
    })
  }, [])

  // On-disk size of the included files — debounced; skipped on gigantic
  // selections so the stat pass stays trivial.
  const [commitSize, setCommitSize] = useState<number | null>(null)
  useEffect(() => {
    const repoPath = repoRef.current?.path
    if (!repoPath) return
    const t = setTimeout(() => {
      const paths: string[] = []
      for (const f of changes) {
        if (f.status === 'conflicted' || f.status === 'deleted') continue
        if ((selections.get(f.path) ?? 'all') !== 'none') paths.push(f.path)
      }
      if (paths.length === 0 || paths.length > 20000) {
        setCommitSize(paths.length === 0 ? 0 : null)
        return
      }
      window.gitgrove
        .selectionSize(repoPath, paths)
        .then(setCommitSize)
        .catch(() => setCommitSize(null))
    }, 400)
    return () => clearTimeout(t)
  }, [changes, selections])

  /** Replace one file's hunk selection (from the diff's checkbox bars). */
  const setHunkSelection = useCallback(
    (path: string, selected: Map<number, string>, totalHunks: number) => {
      setSelections((prev) => {
        const next = new Map(prev)
        if (selected.size === totalHunks) next.delete(path)
        else if (selected.size === 0) next.set(path, 'none')
        else next.set(path, selected)
        return next
      })
    },
    []
  )

  /** Discard a hunk in the working tree (reverse-apply its display patch). */
  const discardHunk = useCallback(
    (patch: string) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return
      runOpRef.current(() => window.gitgrove.applyPatch(repoPath, patch, { reverse: true }))
    },
    []
  )

  const doSync = useCallback(
    async (action: SyncAction) => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return
      setSyncRunning(action)
      try {
        await runOp(() => {
          const gg = window.gitgrove
          switch (action) {
            case 'fetch':
              return gg.fetch(repoPath)
            case 'pull':
              return gg.pull(repoPath)
            case 'pull-rebase':
              return gg.pull(repoPath, { rebase: true })
            case 'push':
              return gg.push(repoPath)
            case 'force-push':
              return gg.push(repoPath, { forceWithLease: true })
            case 'publish': {
              const remotes = syncRef.current?.remotes ?? []
              const remote = remotes.includes('origin') ? 'origin' : remotes[0]
              const current = branchRef.current?.current
              if (!remote || !current) throw new Error('No remote to publish to.')
              return gg.push(repoPath, { setUpstream: { remote, branch: current } })
            }
          }
        })
      } finally {
        setSyncRunning(null)
      }
    },
    [runOp]
  )

  const runOpRef = useRef(runOp)
  runOpRef.current = runOp

  const onBranchAction = useCallback((action: BranchAction, name: string) => {
    const repoPath = repoRef.current?.path
    if (!repoPath) return
    switch (action) {
      case 'new':
        setModal({ kind: 'new-branch', initialName: name })
        break
      case 'merge':
        runOpRef.current(() => window.gitgrove.merge(repoPath, name))
        break
      case 'rebase':
        runOpRef.current(() => window.gitgrove.rebase(repoPath, name))
        break
      case 'rename':
        setModal({ kind: 'rename-branch', name })
        break
      case 'delete':
        setModal({ kind: 'delete-branch', name, force: false })
        break
    }
  }, [])

  /** Right-click menu for a history commit. */
  const commitMenuFor = useCallback(
    (commit: Commit): ContextMenuItem[] => {
      const repoPath = repoRef.current?.path
      if (!repoPath) return []
      const gg = window.gitgrove
      const currentBranch = branchRef.current?.current ?? 'current branch'
      const idx = commits.findIndex((c) => c.hash === commit.hash)
      const isRoot = commit.parents.length === 0
      const isMerge = commit.parents.length > 1
      return [
        {
          label: 'Checkout Commit…',
          icon: <Icon.Branch size={15} />,
          onClick: () =>
            setModal({ kind: 'checkout-commit', hash: commit.hash, shortHash: commit.shortHash })
        },
        {
          label: 'Create Branch Here…',
          icon: <Icon.Plus size={15} />,
          onClick: () =>
            setModal({ kind: 'new-branch', from: commit.hash, fromLabel: commit.shortHash })
        },
        {
          label: 'Create Tag Here…',
          icon: <Icon.Tag size={15} />,
          onClick: () =>
            setModal({ kind: 'create-tag', hash: commit.hash, shortHash: commit.shortHash })
        },
        {},
        {
          label: `Cherry-pick onto ${currentBranch}`,
          icon: <Icon.CherryPick size={15} />,
          onClick: () => runOpRef.current(() => gg.cherryPick(repoPath, commit.hash))
        },
        {
          label: 'Revert Commit…',
          icon: <Icon.Undo size={15} />,
          disabled: isMerge,
          onClick: () =>
            setModal({ kind: 'revert', hash: commit.hash, shortHash: commit.shortHash })
        },
        {
          label: 'Interactive Rebase from Here…',
          icon: <Icon.ListTodo size={15} />,
          // Needs a parent to rebase onto, and the commit must be in the loaded log.
          disabled: isRoot || idx < 0,
          onClick: () =>
            setModal({
              kind: 'irebase',
              commits: commits.slice(0, idx + 1),
              base: `${commit.hash}^`
            })
        },
        {},
        {
          label: `Reset ${currentBranch} Here (soft)`,
          icon: <Icon.Reset size={15} />,
          onClick: () => runOpRef.current(() => gg.reset(repoPath, commit.hash, 'soft'))
        },
        {
          label: `Reset ${currentBranch} Here (mixed)`,
          icon: <Icon.Reset size={15} />,
          onClick: () => runOpRef.current(() => gg.reset(repoPath, commit.hash, 'mixed'))
        },
        {
          label: `Reset ${currentBranch} Here (hard)…`,
          icon: <Icon.Reset size={15} />,
          danger: true,
          onClick: () =>
            setModal({
              kind: 'reset',
              hash: commit.hash,
              shortHash: commit.shortHash,
              mode: 'hard'
            })
        },
        {},
        {
          label: 'Copy Hash',
          icon: <Icon.Copy size={15} />,
          onClick: () => gg.clipboardWrite(commit.hash)
        },
        {
          label: 'Copy Short Hash',
          icon: <Icon.Copy size={15} />,
          onClick: () => gg.clipboardWrite(commit.shortHash)
        }
      ]
    },
    [commits]
  )

  /** Run a modal-confirmed op: spinner while it runs, dialog closes either way
   *  (failures surface as the standard toast). */
  const runModalOp = useCallback(async (fn: () => Promise<unknown>) => {
    setModalBusy(true)
    try {
      await runOpRef.current(fn)
    } finally {
      setModalBusy(false)
      setModal(null)
    }
  }, [])

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

  // ── OS integration: menu commands + filesystem change notifications ────────
  useEffect(() => window.gitgrove.onMenuOpenRepo(() => pickRepo()), [pickRepo])

  useEffect(
    () =>
      window.gitgrove.onMenuCommand((command: MenuCommand) => {
        const hasRepo = !!repoRef.current
        switch (command) {
          case 'clone':
            setModal({ kind: 'clone' })
            break
          case 'fetch':
          case 'pull':
          case 'push':
            if (hasRepo) doSync(command)
            break
          case 'new-branch':
            if (hasRepo) setModal({ kind: 'new-branch' })
            break
          case 'stash':
            if (hasRepo) setModal({ kind: 'stash' })
            break
          case 'worktrees':
            if (hasRepo) setModal({ kind: 'worktrees' })
            break
          case 'submodules':
            if (hasRepo) setModal({ kind: 'submodules' })
            break
          case 'optimize':
            if (hasRepo) {
              const repoPath = repoRef.current?.path
              if (repoPath) runOpRef.current(() => window.gitgrove.optimizeRepo(repoPath))
            }
            break
        }
      }),
    [doSync]
  )

  useEffect(() => {
    return window.gitgrove.onRepoChanged((changedPath) => {
      // Skip watcher-driven refreshes while one of our own ops runs — runOp
      // refreshes once on completion, with the final state.
      if (repoRef.current && changedPath === repoRef.current.path && !busyRef.current) {
        refreshRef.current()
      }
    })
  }, [])

  // Refresh when the window regains focus — the moment external edits (your
  // editor, the terminal) become relevant. Throttled so rapid focus flips
  // don't stack status runs.
  useEffect(() => {
    let last = 0
    const onFocus = () => {
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      if (repoRef.current && !busyRef.current) refreshRef.current()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Quiet background fetch so ahead/behind stays honest without manual checks.
  useEffect(() => {
    if (!repo) return
    const t = setInterval(() => {
      const repoPath = repoRef.current?.path
      if (!repoPath || busyRef.current || syncRef.current?.remotes.length === 0) return
      window.gitgrove
        .fetch(repoPath)
        .then(() => refreshRef.current())
        .catch(() => {})
    }, AUTO_FETCH_INTERVAL)
    return () => clearInterval(t)
  }, [repo])

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
        if (status.manual) setUpdateFeedbackDismissed(false)
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

  useEffect(() => {
    if (!update?.manual || updateFeedbackDismissed) return
    if (!['not-available', 'error', 'dev'].includes(update.state)) return
    const t = setTimeout(() => setUpdateFeedbackDismissed(true), 5000)
    return () => clearTimeout(t)
  }, [update, updateFeedbackDismissed])

  const deferredReady =
    (update?.state === 'downloaded' || update?.state === 'manual-install') &&
    update.newVersion === dismissedUpdate
  const isProgress =
    update?.state === 'downloading' ||
    update?.state === 'available' ||
    update?.state === 'downloaded' ||
    update?.state === 'manual-install'
  const isManualFeedback =
    !!update?.manual &&
    (update.state === 'checking' ||
      update.state === 'not-available' ||
      update.state === 'error' ||
      update.state === 'dev')
  const bannerUpdate =
    update &&
    ((isProgress && !deferredReady) || (isManualFeedback && !updateFeedbackDismissed && !aboutOpen))
      ? update
      : null

  const dismissBanner = () => {
    if (update?.state === 'downloaded' || update?.state === 'manual-install') {
      setDismissedUpdate(update.newVersion ?? null)
    } else {
      setUpdateFeedbackDismissed(true)
    }
  }

  // ── App-level modals ───────────────────────────────────────────────────────
  const repoPath = repo?.path
  const modals = repoPath && modal && (
    <>
      {modal.kind === 'new-branch' && (
        <PromptDialog
          title={modal.from ? `New branch at ${modal.fromLabel}` : 'New branch'}
          confirmLabel="Create branch"
          busy={modalBusy}
          fields={[
            {
              key: 'name',
              label: 'Branch name',
              placeholder: 'feature/my-change',
              initial: modal.initialName,
              validate: validateRefName
            },
            {
              key: 'checkout',
              label: 'Check out the new branch',
              checkbox: true,
              initialChecked: true
            }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              window.gitgrove.createBranch(repoPath, values.name.trim(), {
                from: modal.from,
                checkout: checks.checkout
              })
            )
          }
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'rename-branch' && (
        <PromptDialog
          title={`Rename ${modal.name}`}
          confirmLabel="Rename"
          busy={modalBusy}
          fields={[
            { key: 'name', label: 'New name', initial: modal.name, validate: validateRefName }
          ]}
          onSubmit={(values) =>
            runModalOp(() => window.gitgrove.renameBranch(repoPath, modal.name, values.name.trim()))
          }
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'delete-branch' && (
        <ConfirmDialog
          title={`Delete ${modal.name}?`}
          danger
          busy={modalBusy}
          body={
            modal.force ? (
              <>
                <code>{modal.name}</code> has commits that aren't merged anywhere else. Deleting it
                will lose them (recoverable from the reflog for a while).
              </>
            ) : (
              <>
                The local branch <code>{modal.name}</code> will be deleted. Its remote
                counterpart, if any, is untouched.
              </>
            )
          }
          confirmLabel={modal.force ? 'Force delete' : 'Delete'}
          onConfirm={async () => {
            setModalBusy(true)
            try {
              await window.gitgrove.deleteBranch(repoPath, modal.name, { force: modal.force })
              setModal(null)
              await refreshRef.current()
            } catch (e) {
              // `-d` refuses unmerged branches; escalate to an explicit force confirm.
              if (!modal.force && /not fully merged/i.test(e instanceof Error ? e.message : '')) {
                setModal({ kind: 'delete-branch', name: modal.name, force: true })
              } else {
                setModal(null)
                fail(e)
              }
            } finally {
              setModalBusy(false)
            }
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'create-tag' && (
        <PromptDialog
          title={`Tag commit ${modal.shortHash}`}
          confirmLabel="Create tag"
          busy={modalBusy}
          fields={[
            { key: 'name', label: 'Tag name', placeholder: 'v1.2.0', validate: validateRefName },
            { key: 'message', label: 'Message (annotated tag, optional)' },
            { key: 'push', label: 'Push tag to remote', checkbox: true, initialChecked: false }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              window.gitgrove.createTag(repoPath, values.name.trim(), {
                hash: modal.hash,
                message: values.message,
                push: checks.push
              })
            )
          }
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'reset' && (
        <ConfirmDialog
          title={`Hard reset to ${modal.shortHash}?`}
          danger
          busy={modalBusy}
          body={
            <>
              <code>{branch?.current}</code> will point at <code>{modal.shortHash}</code> and{' '}
              <strong>all uncommitted changes are discarded</strong>. Commits left behind stay in
              the reflog for a while.
            </>
          }
          confirmLabel="Hard reset"
          onConfirm={() =>
            runModalOp(() => window.gitgrove.reset(repoPath, modal.hash, modal.mode))
          }
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'revert' && (
        <ConfirmDialog
          title={`Revert ${modal.shortHash}?`}
          busy={modalBusy}
          body="A new commit will be created that undoes this commit's changes. Your working tree must be clean enough for the revert to apply."
          confirmLabel="Revert"
          onConfirm={() => runModalOp(() => window.gitgrove.revertCommit(repoPath, modal.hash))}
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'checkout-commit' && (
        <ConfirmDialog
          title={`Checkout ${modal.shortHash}?`}
          busy={modalBusy}
          body="This detaches HEAD: you can look around and build, but new commits won't belong to any branch until you create one. Switch back to a branch to return to normal."
          confirmLabel="Checkout"
          onConfirm={async () => {
            const ok = await runOpRef.current(() =>
              window.gitgrove.checkoutDetached(repoPath, modal.hash)
            )
            setModal(null)
            if (ok) {
              setLogLoaded(false)
              if (tabRef.current === 'history') loadLog(repoPath).catch(fail)
            }
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'irebase' && (
        <InteractiveRebaseDialog
          commits={modal.commits}
          base={modal.base}
          busy={modalBusy}
          onSubmit={(items) =>
            runModalOp(() => window.gitgrove.rebaseInteractive(repoPath, modal.base, items))
          }
          onCancel={() => setModal(null)}
        />
      )}
      {modal.kind === 'worktrees' && (
        <WorktreesDialog
          repoPath={repoPath}
          localBranches={branch?.local ?? []}
          onOpenRepo={openRepoByPath}
          onError={fail}
          onClose={() => setModal(null)}
        />
      )}
      {modal.kind === 'submodules' && (
        <SubmodulesDialog
          repoPath={repoPath}
          onOpenRepo={openRepoByPath}
          onError={fail}
          onClose={() => setModal(null)}
        />
      )}
      {modal.kind === 'stash' && (
        <PromptDialog
          title="Stash all changes"
          confirmLabel="Stash"
          busy={modalBusy}
          fields={[
            { key: 'message', label: 'Message (optional)' },
            {
              key: 'untracked',
              label: 'Include untracked files',
              checkbox: true,
              initialChecked: true
            }
          ]}
          onSubmit={(values, checks) =>
            runModalOp(() =>
              window.gitgrove.stashSave(repoPath, {
                message: values.message,
                includeUntracked: checks.untracked
              })
            )
          }
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )

  const overlays = (
    <>
      <UpdateBanner update={bannerUpdate} onInstall={installUpdate} onDismiss={dismissBanner} />
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
      {modal?.kind === 'clone' && (
        <CloneDialog
          onDone={(path) => {
            setModal(null)
            openRepoByPath(path)
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modals}
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
          <Welcome
            onPickRepo={pickRepo}
            onOpenRepo={openRepoByPath}
            onClone={() => setModal({ kind: 'clone' })}
          />
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
        sync={sync}
        syncRunning={syncRunning}
        onSyncAction={doSync}
        onBranchAction={onBranchAction}
        onBranchesOpen={reloadBranches}
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
                repoPath={repo.path}
                branch={
                  branch?.detached
                    ? `detached @ ${branch.current.slice(0, 7)}`
                    : (branch?.current ?? '')
                }
                changes={changes}
                loading={changesLoading}
                busy={busy}
                repoState={repoState}
                stashes={stashes}
                selectedPath={changeSel}
                onSelectFile={(path) => selectWorkingFile(path)}
                selections={selections}
                onToggleFile={toggleFileIncluded}
                onSetAllIncluded={setAllIncluded}
                commitSize={commitSize}
                theme={theme}
                runOp={runOp}
                onCommit={doCommit}
                onStash={doStash}
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
                commitMenuFor={commitMenuFor}
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
            selectionActions={
              tab === 'changes' && changeSel
                ? {
                    selection: selections.get(changeSel) ?? 'all',
                    onChange: (selected, total) => setHunkSelection(changeSel, selected, total),
                    onDiscard: discardHunk,
                    busy
                  }
                : undefined
            }
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
