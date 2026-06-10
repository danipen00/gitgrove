// The interactive-rebase editor: the commits from the chosen base up to HEAD,
// oldest first (git's todo order), each with an action picker, drag-or-button
// reordering, and an inline message editor for reword/squash. Submitting runs
// a fully scripted `git rebase -i` in the main process — no terminal editor
// ever opens; conflicts fall back to the standard conflict banner.

import type { Commit, RebaseAction, RebaseTodoItem } from '@shared/types'
import { useMemo, useState } from 'react'
import { DialogShell } from '@/components/common/Dialog'
import { Icon } from '@/lib/icons'

interface Props {
  /** Commits to rebase, newest-first as they come from the log. */
  commits: Commit[]
  /** The ref the todo rebases onto (parent of the oldest commit). */
  base: string
  busy: boolean
  onSubmit: (items: RebaseTodoItem[]) => void
  onCancel: () => void
}

interface Row {
  hash: string
  shortHash: string
  subject: string
  action: RebaseAction
  message: string
}

const ACTIONS: { value: RebaseAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep the commit as is' },
  { value: 'reword', label: 'Reword', hint: 'Keep it, edit the message' },
  { value: 'squash', label: 'Squash', hint: 'Meld into the commit above' },
  { value: 'fixup', label: 'Fixup', hint: 'Meld up, discard this message' },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit' }
]

export function InteractiveRebaseDialog({ commits, base, busy, onSubmit, onCancel }: Props) {
  // Oldest first — the order git applies them and the order users expect to read a todo.
  const [rows, setRows] = useState<Row[]>(() =>
    [...commits].reverse().map((c) => ({
      hash: c.hash,
      shortHash: c.shortHash,
      subject: c.subject,
      action: 'pick',
      message: ''
    }))
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return
    setRows((r) => {
      const next = [...r]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const setAction = (i: number, action: RebaseAction) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, action } : row)))
  const setMessage = (i: number, message: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, message } : row)))

  const problem = useMemo(() => {
    const kept = rows.filter((r) => r.action !== 'drop')
    if (kept.length === 0) return 'Every commit is dropped — nothing would remain.'
    if (kept[0].action === 'squash' || kept[0].action === 'fixup') {
      return 'The first kept commit cannot squash — there is nothing above it.'
    }
    return null
  }, [rows])

  const changed = rows.some((r, i) => {
    const original = commits[commits.length - 1 - i]
    return r.action !== 'pick' || r.hash !== original?.hash
  })

  return (
    <DialogShell
      title={`Interactive rebase — ${rows.length} commits`}
      icon={<Icon.ListTodo size={22} />}
      busy={busy}
      onClose={onCancel}
      width={620}
    >
      <p className="trust__body" style={{ marginBottom: 8 }}>
        Reorder, squash, reword or drop the commits below, applied oldest → newest onto{' '}
        <code className="trust__path">{base.slice(0, 10)}</code>. History is rewritten —
        already-pushed commits will need a force push.
      </p>

      <div className="irebase">
        {rows.map((row, i) => (
          <div
            key={row.hash}
            className={`irebase__row${row.action === 'drop' ? ' is-dropped' : ''}${
              dragIndex === i ? ' is-dragging' : ''
            }`}
            draggable={!busy}
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== i) {
                move(dragIndex, i)
                setDragIndex(i)
              }
            }}
          >
            <span className="irebase__grip" data-tip="Drag to reorder">
              <Icon.Grip size={14} />
            </span>
            <select
              className="irebase__action"
              value={row.action}
              disabled={busy}
              onChange={(e) => setAction(i, e.target.value as RebaseAction)}
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value} title={a.hint}>
                  {a.label}
                </option>
              ))}
            </select>
            <div className="irebase__main">
              <span className="irebase__subject" data-tip={row.subject} data-tip-overflow="">
                <code className="irebase__hash">{row.shortHash}</code> {row.subject}
              </span>
              {(row.action === 'reword' || row.action === 'squash') && (
                <input
                  className="irebase__message"
                  placeholder={
                    row.action === 'reword'
                      ? 'New commit message'
                      : 'Combined message (optional — keeps both by default)'
                  }
                  value={row.message}
                  disabled={busy}
                  onChange={(e) => setMessage(i, e.target.value)}
                />
              )}
            </div>
            <span className="irebase__order">
              <button
                className="section-head__action"
                disabled={busy || i === 0}
                data-tip="Move up (earlier)"
                onClick={() => move(i, i - 1)}
              >
                ↑
              </button>
              <button
                className="section-head__action"
                disabled={busy || i === rows.length - 1}
                data-tip="Move down (later)"
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>

      {problem && <p className="dlg-error">{problem}</p>}

      <div className="trust__actions">
        <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn-primary btn-primary--sm"
          disabled={busy || !!problem || !changed}
          data-tip={!changed ? 'Nothing changed yet' : undefined}
          onClick={() =>
            onSubmit(
              rows.map((r) => ({
                hash: r.hash,
                action: r.action,
                message: r.message.trim() || undefined
              }))
            )
          }
        >
          {busy && <span className="about__spinner" aria-hidden />}
          Start rebase
        </button>
      </div>
    </DialogShell>
  )
}
