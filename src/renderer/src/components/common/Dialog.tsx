// Small modal primitives shared by the write-action dialogs: a generic shell
// (backdrop + Escape/Enter handling) plus ready-made prompt and confirm
// dialogs. Styled with the same .modal/.trust tokens as the existing dialogs.

import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/lib/icons'

interface DialogShellProps {
  title: string
  /** Renders the alert icon tinted red instead of the default amber. */
  danger?: boolean
  icon?: ReactNode
  busy?: boolean
  onClose: () => void
  children: ReactNode
  /** Width of the dialog; defaults to the .modal CSS width. */
  width?: number
}

export function DialogShell({
  title,
  danger,
  icon,
  busy,
  onClose,
  children,
  width
}: DialogShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal trust"
        role="dialog"
        aria-modal="true"
        style={width ? { width, maxWidth: '92vw' } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="trust__head">
          {icon && (
            <span className={`trust__icon${danger ? ' trust__icon--danger' : ''}`}>{icon}</span>
          )}
          <h2 className="trust__title">{title}</h2>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

interface ConfirmDialogProps {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** "Are you sure?" with a destructive-styled primary action when `danger`. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <DialogShell
      title={title}
      danger={danger}
      icon={<Icon.Alert size={22} />}
      busy={busy}
      onClose={onCancel}
    >
      <div className="trust__body">{body}</div>
      <div className="trust__actions">
        <button className="btn-ghost btn-ghost--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className={`btn-primary btn-primary--sm${danger ? ' btn-danger' : ''}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <span className="about__spinner" aria-hidden />}
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  )
}

export interface PromptField {
  key: string
  label: string
  placeholder?: string
  initial?: string
  /** Render as a checkbox instead of a text input. */
  checkbox?: boolean
  initialChecked?: boolean
  /** Optional validation; return an error string to block submission. */
  validate?: (value: string) => string | null
}

interface PromptDialogProps {
  title: string
  fields: PromptField[]
  confirmLabel: string
  busy?: boolean
  /** Optional explanatory line under the fields. */
  note?: ReactNode
  onSubmit: (values: Record<string, string>, checks: Record<string, boolean>) => void
  onCancel: () => void
}

/** A small form dialog: text fields and checkboxes, Enter submits. */
export function PromptDialog({
  title,
  fields,
  confirmLabel,
  busy,
  note,
  onSubmit,
  onCancel
}: PromptDialogProps) {
  const id = useId()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => !f.checkbox).map((f) => [f.key, f.initial ?? '']))
  )
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      fields.filter((f) => f.checkbox).map((f) => [f.key, f.initialChecked ?? false])
    )
  )
  const [error, setError] = useState<string | null>(null)

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    for (const f of fields) {
      if (f.checkbox) continue
      const err = f.validate?.(values[f.key] ?? '')
      if (err) {
        setError(err)
        return
      }
    }
    onSubmit(values, checks)
  }

  return (
    <DialogShell title={title} busy={busy} onClose={onCancel}>
      <form onSubmit={submit}>
        {fields.map((f, i) =>
          f.checkbox ? (
            <label key={f.key} className="dlg-check">
              <input
                type="checkbox"
                checked={checks[f.key] ?? false}
                disabled={busy}
                onChange={(e) => setChecks((c) => ({ ...c, [f.key]: e.target.checked }))}
              />
              {f.label}
            </label>
          ) : (
            <div key={f.key} className="dlg-field">
              <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
              <input
                id={`${id}-${f.key}`}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={values[f.key] ?? ''}
                disabled={busy}
                onChange={(e) => {
                  setError(null)
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }}
              />
            </div>
          )
        )}
        {note && <p className="trust__note">{note}</p>}
        {error && <p className="dlg-error">{error}</p>}
        <div className="trust__actions">
          <button
            type="button"
            className="btn-ghost btn-ghost--sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>
            {busy && <span className="about__spinner" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

/** Validate a proposed git ref name well enough for the UI (git re-checks). */
export function validateRefName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name.'
  if (/[\s~^:?*[\\]|\.\.|@\{|^\/|\/$|\.lock$|^\.|\/\./.test(n)) {
    return 'That name contains characters git does not allow.'
  }
  return null
}
