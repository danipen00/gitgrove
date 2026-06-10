// Maps git's per-phase progress onto one 0–100 scale per operation, so a
// button can fill determinately while git works. git reports each phase
// ("Receiving objects: 42%") independently from 0 to 100; without weighting,
// the fill would snap back to zero every time a phase hands over. The spans
// below apportion the scale by where the wall-clock time actually goes
// (network transfer dominates; the bookkeeping phases are thin slices).

import type { ProgressOpKind } from '@shared/types'

/** A phase's slice of the overall scale: its 0–100 maps into [start, end]. */
interface PhaseSpan {
  phase: string
  start: number
  end: number
}

const span = (phase: string, start: number, end: number): PhaseSpan => ({ phase, start, end })

const PHASES: Record<ProgressOpKind, PhaseSpan[]> = {
  fetch: [
    span('Counting objects', 0, 5),
    span('Compressing objects', 5, 10),
    span('Receiving objects', 10, 85),
    span('Resolving deltas', 85, 100)
  ],
  // Pull = fetch + integrate: the same download phases squeezed left to leave
  // room for the working-tree update at the end.
  pull: [
    span('Counting objects', 0, 5),
    span('Compressing objects', 5, 10),
    span('Receiving objects', 10, 75),
    span('Resolving deltas', 75, 90),
    span('Updating files', 90, 100)
  ],
  push: [
    span('Counting objects', 0, 10),
    span('Compressing objects', 10, 25),
    span('Writing objects', 25, 90),
    // Reported back by the server ("remote: Resolving deltas").
    span('Resolving deltas', 90, 100)
  ],
  checkout: [
    span('Updating files', 0, 100),
    // Pre-2.24 name for the same phase.
    span('Checking out files', 0, 100)
  ],
  // Discard: per-file trashing, then the two git steps. The early spans are
  // skipped when a discard has nothing to trash — the bar simply starts
  // further along.
  discard: [
    span('Moving to trash', 0, 30),
    span('Resetting index', 30, 40),
    span('Restoring files', 40, 100)
  ]
}

/**
 * Overall 0–100 for a phase report, or null when the phase is unknown for the
 * operation (callers keep their previous value, so the fill never jumps on a
 * phase we didn't anticipate).
 */
export function overallPercent(
  kind: ProgressOpKind,
  phase: string,
  percent: number
): number | null {
  const s = PHASES[kind].find((p) => p.phase === phase)
  if (!s) return null
  const within = Math.max(0, Math.min(100, percent))
  return Math.round(s.start + ((s.end - s.start) * within) / 100)
}
