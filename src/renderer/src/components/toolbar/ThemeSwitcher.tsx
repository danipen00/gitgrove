import { useRef, useState } from 'react'
import { Popover } from '@/components/common/Popover'
import { Icon } from '@/lib/icons'
import type { ResolvedTheme, ThemePref } from '@/lib/theme'

interface Props {
  pref: ThemePref
  resolved: ResolvedTheme
  onChange: (pref: ThemePref) => void
}

const OPTIONS: { value: ThemePref; label: string; sub: string; icon: keyof typeof Icon }[] = [
  { value: 'system', label: 'System', sub: 'Match the OS appearance', icon: 'Monitor' },
  { value: 'light', label: 'Light', sub: 'Bright surfaces', icon: 'Sun' },
  { value: 'dark', label: 'Dark', sub: 'Deep, calm dark UI', icon: 'Moon' }
]

export function ThemeSwitcher({ pref, resolved, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  // The trigger glyph reflects what's actually showing, not the preference, so
  // 'System' surfaces a sun or moon depending on the resolved scheme.
  const TriggerIcon = resolved === 'light' ? Icon.Sun : Icon.Moon

  return (
    <>
      <button
        ref={anchor}
        className="toolbar__refresh"
        title="Theme"
        onClick={() => setOpen((v) => !v)}
      >
        <TriggerIcon size={16} />
      </button>

      <Popover
        anchor={anchor.current}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        width={240}
      >
        <div className="popover__list">
          <div className="popover__group-label">Appearance</div>
          {OPTIONS.map((opt) => {
            const OptIcon = Icon[opt.icon]
            return (
              <button
                key={opt.value}
                className={`popover__item${pref === opt.value ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="icon-muted">
                  <OptIcon size={15} />
                </span>
                <span className="popover__item-main">
                  <span className="popover__item-title">{opt.label}</span>
                  <span className="popover__item-sub">{opt.sub}</span>
                </span>
                {pref === opt.value && (
                  <span className="icon-muted" style={{ color: 'var(--accent)' }}>
                    <Icon.Check size={15} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
