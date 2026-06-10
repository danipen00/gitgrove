// The branch switcher's row model: a flat list of section labels and branch
// items, so a single virtualized scroller can window all groups together.
// Pure so it can be unit-tested without driving the popover.

import type { BranchInfo } from '@shared/types'

export type BranchRow =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'item'; key: string; name: string; current: boolean; local: boolean }

/**
 * The section model: DEFAULT and RECENT first (the branches you're most
 * likely heading to), then the remaining locals and remotes, each already
 * sorted most-recently-committed first by the main process. A branch in
 * DEFAULT/RECENT never repeats in LOCAL. Sections whose rows are all filtered
 * out (or empty) drop their label too.
 */
export function buildBranchRows(branch: BranchInfo | null, query: string): BranchRow[] {
  if (!branch) return []
  const q = query.trim().toLowerCase()
  const match = (n: string) => n.toLowerCase().includes(q)
  const item = (prefix: string, name: string, local: boolean): BranchRow => ({
    kind: 'item',
    key: `${prefix}:${name}`,
    name,
    current: local && name === branch.current,
    local
  })

  const elsewhere = new Set(branch.recent)
  if (branch.defaultBranch) elsewhere.add(branch.defaultBranch)

  const sections: Array<{ text: string; rows: BranchRow[] }> = [
    {
      text: 'Default branch',
      rows:
        branch.defaultBranch && branch.local.includes(branch.defaultBranch)
          ? [branch.defaultBranch].filter(match).map((n) => item('d', n, true))
          : []
    },
    {
      text: 'Recent branches',
      rows: branch.recent.filter(match).map((n) => item('rec', n, true))
    },
    {
      text: 'Local',
      rows: branch.local.filter((n) => !elsewhere.has(n) && match(n)).map((n) => item('l', n, true))
    },
    {
      text: 'Remote',
      rows: branch.remote.filter(match).map((n) => item('r', n, false))
    }
  ]

  const out: BranchRow[] = []
  for (const { text, rows } of sections) {
    if (rows.length === 0) continue
    out.push({ kind: 'label', key: `label-${text}`, text })
    out.push(...rows)
  }
  return out
}
