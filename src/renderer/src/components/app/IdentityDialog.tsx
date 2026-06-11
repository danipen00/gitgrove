// First-commit identity setup. git refuses to commit until user.name and
// user.email are configured ("Please tell me who you are") — instead of
// surfacing that error, App probes before committing and collects the
// identity here, then finishes the interrupted commit. Saved to the global
// git config by default so this is a once-per-machine question; the checkbox
// scopes it to the open repository instead.

import type { IdentityScope } from '@shared/types'
import { PromptDialog } from '@/components/common/Dialog'

interface Props {
  busy: boolean
  /** Prefill from a connected account, so the common case is just Enter. */
  initialName?: string
  initialEmail?: string
  onSubmit: (name: string, email: string, scope: IdentityScope) => void
  onCancel: () => void
}

export function IdentityDialog({ busy, initialName, initialEmail, onSubmit, onCancel }: Props) {
  return (
    <PromptDialog
      title="Tell git who you are"
      confirmLabel="Save and commit"
      busy={busy}
      fields={[
        {
          key: 'name',
          label: 'Name',
          placeholder: 'Ada Lovelace',
          initial: initialName,
          validate: (v) => (v.trim() ? null : 'Enter your name.')
        },
        {
          key: 'email',
          label: 'Email',
          placeholder: 'ada@example.com',
          initial: initialEmail,
          // Light check only — git accepts anything with an @; it re-validates.
          validate: (v) => (/\S+@\S+/.test(v.trim()) ? null : 'Enter a valid email address.')
        },
        {
          key: 'local',
          label: 'Use this identity only in this repository',
          checkbox: true,
          initialChecked: false
        }
      ]}
      note={
        <>
          Every commit records an author name and email. They are saved to your git config, so you
          will only be asked once.
        </>
      }
      onSubmit={(values, checks) =>
        onSubmit(values.name.trim(), values.email.trim(), checks.local ? 'local' : 'global')
      }
      onCancel={onCancel}
    />
  )
}
