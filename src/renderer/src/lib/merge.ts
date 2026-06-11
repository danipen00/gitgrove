// Pure helpers for the merge workflow UI (banner copy, composer pre-fill).

/**
 * Extract the branch (or tag) being merged from the first line of git's
 * prepared merge message (RepoState.detail), e.g. "Merge branch 'feature/x'
 * into main" or "Merge remote-tracking branch 'origin/main'". Null when the
 * line doesn't look like a merge message — callers fall back to neutral copy.
 */
export function mergeSourceFromDetail(detail: string | undefined): string | null {
  if (!detail) return null
  const m = detail.match(/^Merge (?:remote-tracking )?branch '([^']+)'|^Merge tag '([^']+)'/)
  return m ? (m[1] ?? m[2]) : null
}

/** The four ways to resolve a conflicted file. */
export interface ConflictActionLabels {
  tool: string
  ours: string
  theirs: string
  mark: string
}

/**
 * Shared labels for the conflict-resolution actions. The panel's split
 * button, its caret menu, and the file context menu must always say exactly
 * the same thing — one source keeps them from drifting apart.
 */
export function conflictActionLabels(opts: {
  /** Configured merge.tool name; null = git auto-picks. */
  toolName: string | null
  /** Current branch (the "ours" side); null when unknown. */
  ours: string | null
  /** Branch being merged in; null when unknown. */
  theirs: string | null
}): ConflictActionLabels {
  // "Ours/Theirs" is git's own vocabulary — the same words every merge tool
  // pane uses — with the branch name in parentheses to remove the ambiguity.
  return {
    tool: `Resolve in ${opts.toolName ?? 'Merge Tool'}`,
    ours: `Resolve Using Ours${opts.ours ? ` (${opts.ours})` : ''}`,
    theirs: `Resolve Using Theirs${opts.theirs ? ` (${opts.theirs})` : ''}`,
    mark: 'Mark as Resolved'
  }
}
