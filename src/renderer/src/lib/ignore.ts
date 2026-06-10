// Builds the "Ignore" context-menu options for untracked files: which
// .gitignore lines each choice would add, and how many of the currently
// untracked files it would hide — so the menu can say what it really does
// before the user commits to it. All pure; the chosen pattern lines are
// appended to .gitignore by the main process (git/write.ts, ignorePatterns).

import { splitPath } from './format'

export interface IgnoreOption {
  /** Menu label, e.g. `Ignore All .log Files (4)`. */
  label: string
  /** The exact .gitignore lines this option appends. */
  patterns: string[]
  /** Untracked files the patterns hide — the rows that vanish from Changes. */
  count: number
}

/**
 * Escape a literal path so gitignore treats every character verbatim:
 * glob metacharacters (`* ? [ ]`) and backslashes are backslash-escaped,
 * a leading `#` (comment) or `!` (negation) is neutralized, and trailing
 * spaces — which git silently strips — are kept by escaping them.
 */
export function escapeIgnorePattern(path: string): string {
  let p = path.replace(/[\\*?[\]]/g, '\\$&')
  if (p.startsWith('#') || p.startsWith('!')) p = `\\${p}`
  return p.replace(/ +$/, (m) => '\\ '.repeat(m.length))
}

/** `/`-anchored pattern matching exactly this repo-relative path. */
const exactPattern = (path: string): string => `/${escapeIgnorePattern(path)}`

/** `(4)` count suffix; omitted when the option only hides the file itself. */
const countSuffix = (count: number): string => (count > 1 ? ` (${count})` : '')

/**
 * The ignore options for one untracked file, most specific first:
 *
 *  - the file itself (`/dir/app.log`);
 *  - every file with the same extension (`*.log`), or — for extensionless
 *    dotfiles like `.DS_Store` — every file with the same name, anywhere;
 *  - the containing folder (`/dir/`), when the file isn't at the repo root.
 *
 * `untrackedPaths` is the full untracked list (unfiltered), used only to
 * count what each pattern would hide right now.
 */
export function ignoreOptionsFor(path: string, untrackedPaths: string[]): IgnoreOption[] {
  const { dir, name } = splitPath(path)
  const options: IgnoreOption[] = [
    { label: `Ignore File "${name}"`, patterns: [exactPattern(path)], count: 1 }
  ]
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot) // ".log" — includes the dot for the label
    const count = untrackedPaths.filter((p) => p.endsWith(ext)).length
    options.push({
      label: `Ignore All ${ext} Files${countSuffix(count)}`,
      patterns: [`*${escapeIgnorePattern(ext)}`],
      count
    })
  } else if (dot === 0 && name.length > 1) {
    // Dotfile with no further extension (.DS_Store, .env): ignoring "all of
    // them" means this exact name anywhere in the tree.
    const count = untrackedPaths.filter((p) => splitPath(p).name === name).length
    options.push({
      label: `Ignore All ${name} Files${countSuffix(count)}`,
      patterns: [escapeIgnorePattern(name)],
      count
    })
  }

  if (dir !== '') {
    const folder = dir.replace(/\/$/, '')
    const folderName = splitPath(folder).name
    const count = untrackedPaths.filter((p) => p.startsWith(dir)).length
    options.push({
      label: `Ignore Folder "${folderName}"${countSuffix(count)}`,
      patterns: [`/${escapeIgnorePattern(folder)}/`],
      count
    })
  }

  return options
}

/** One option ignoring a multi-selection: an exact pattern per file. */
export function ignoreSelectionOption(paths: string[], totalSelected: number): IgnoreOption {
  const qualifier = paths.length === totalSelected ? '' : ' Untracked'
  return {
    label:
      paths.length === 1
        ? `Ignore${qualifier} File`
        : `Ignore ${paths.length}${qualifier} Files`,
    patterns: paths.map(exactPattern),
    count: paths.length
  }
}
