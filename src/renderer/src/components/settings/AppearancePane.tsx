// Settings → Appearance: the theme preference (system / light / dark). The
// same control the toolbar offers, centralized here so settings is the one
// place to look for "how do I change…".

import { Icon } from '@/lib/icons'
import type { ThemePref } from '@/lib/theme'

interface Props {
  pref: ThemePref
  onChange: (pref: ThemePref) => void
}

const OPTIONS: Array<{ value: ThemePref; label: string; sub: string }> = [
  { value: 'system', label: 'System', sub: 'Follow the OS light/dark setting' },
  { value: 'light', label: 'Light', sub: 'Always light' },
  { value: 'dark', label: 'Dark', sub: 'Always dark' }
]

export function AppearancePane({ pref, onChange }: Props) {
  const icon = (value: ThemePref) =>
    value === 'system' ? (
      <Icon.Monitor size={18} />
    ) : value === 'light' ? (
      <Icon.Sun size={18} />
    ) : (
      <Icon.Moon size={18} />
    )
  return (
    <div className="acct-flow" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={pref === option.value}
          className={`acct-choice${pref === option.value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {icon(option.value)}
          <span className="acct-choice__main">
            <span className="acct-choice__title">{option.label}</span>
            <span className="acct-choice__sub">{option.sub}</span>
          </span>
          {pref === option.value && <Icon.Check size={14} />}
        </button>
      ))}
    </div>
  )
}
