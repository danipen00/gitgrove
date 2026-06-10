// The commit box at the bottom of the Changes sidebar: summary + optional
// description and one plain commit button whose label shows what will happen
// — how many files, how large, which branch. The Commit | Amend mode lives in
// the row above (next to the stash chips, owned by ChangesView) and arrives
// as a prop: switching to Amend pre-fills HEAD's message here, switching back
// restores the draft. Commit signing follows the user's git config — commits
// run through the real `git commit` in the main process.

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes, pluralize } from '../lib/format'
import { Icon } from '../lib/icons'

interface Props {
  repoPath: string
  /** Current branch name, for the button label. */
  branch: string
  /** Files included in the next commit — the button is disabled at zero (unless amending). */
  includedCount: number
  /** On-disk size of the included files (bytes), or null while unknown. */
  commitSize: number | null
  /** Disabled while another operation runs. */
  busy: boolean
  /** Commit mode (controlled by the switch in the row above). */
  amend: boolean
  /** True while a commit is running — reported up so the mode switch can lock. */
  onCommittingChange: (committing: boolean) => void
  onCommit: (message: string, amend: boolean) => Promise<boolean>
}

export function CommitComposer({
  repoPath,
  branch,
  includedCount,
  commitSize,
  busy,
  amend,
  onCommittingChange,
  onCommit
}: Props) {
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [committing, setCommittingState] = useState(false)
  const setCommitting = useCallback(
    (value: boolean) => {
      setCommittingState(value)
      onCommittingChange(value)
    },
    [onCommittingChange]
  )

  // Remember what the composer held before amend pre-filled it, so leaving
  // amend mode restores the user's draft instead of leaving HEAD's message.
  const draftRef = useRef<{ summary: string; description: string } | null>(null)

  // Reset on repo switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repoPath is the intentional reset trigger
  useEffect(() => {
    setSummary('')
    setDescription('')
    draftRef.current = null
  }, [repoPath])

  // React to the (controlled) mode: entering Amend saves the draft and
  // pre-fills HEAD's message; leaving it restores the draft.
  const prevAmend = useRef(amend)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the amend flip should trigger this
  useEffect(() => {
    if (amend === prevAmend.current) return
    prevAmend.current = amend
    if (amend) {
      draftRef.current = { summary, description }
      window.gitgrove
        .lastCommitMessage(repoPath)
        .then((msg) => {
          const [first, ...rest] = msg.split('\n')
          setSummary(first ?? '')
          setDescription(rest.join('\n').replace(/^\n+/, ''))
        })
        .catch(() => {})
    } else {
      const draft = draftRef.current
      setSummary(draft?.summary ?? '')
      setDescription(draft?.description ?? '')
      draftRef.current = null
    }
  }, [amend])

  const canCommit =
    summary.trim().length > 0 && (includedCount > 0 || amend) && !busy && !committing

  const commit = useCallback(async () => {
    if (!canCommit) return
    setCommitting(true)
    try {
      const message = description.trim()
        ? `${summary.trim()}\n\n${description.trim()}`
        : summary.trim()
      const ok = await onCommit(message, amend)
      if (ok) {
        setSummary('')
        setDescription('')
        draftRef.current = null
      }
    } finally {
      setCommitting(false)
    }
  }, [canCommit, summary, description, amend, onCommit])

  // Cmd/Ctrl+Enter commits from either field.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      commit()
    }
  }

  const label = amend
    ? 'Amend last commit'
    : includedCount > 0
      ? `Commit ${pluralize(includedCount, 'file')} to ${branch}` +
        (commitSize !== null && commitSize > 0 ? ` · ${formatBytes(commitSize)}` : '')
      : `Commit to ${branch}`

  return (
    <div className="composer">
      <input
        className="composer__summary"
        placeholder={amend ? 'Amend commit summary' : 'Commit summary'}
        value={summary}
        maxLength={500}
        disabled={busy || committing}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <textarea
        className="composer__description"
        placeholder="Description (optional)"
        value={description}
        rows={description ? 3 : 1}
        disabled={busy || committing}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        className="btn-primary composer__commit"
        disabled={!canCommit}
        data-tip={
          includedCount === 0 && !amend
            ? 'Select some changes first'
            : 'Commit selected changes (⌘↵)'
        }
        onClick={commit}
      >
        {committing ? <span className="about__spinner" aria-hidden /> : <Icon.Check size={14} />}
        <span className="composer__commit-label">{label}</span>
      </button>
    </div>
  )
}
