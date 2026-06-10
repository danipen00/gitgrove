// The "Copy Relative Path" / "Copy Full Path" pair offered for any file
// selection. Git reports repo-relative POSIX paths (`file.path`); the relative
// item copies those verbatim, the full item joins them onto the repo root so
// the result is an absolute path you can paste into a terminal or editor. Both
// copy one path per line for a multi-selection. Shared by every file list
// (Changes, History, Stash review) so the wording and behaviour stay identical
// without those views depending on each other.

import type { ChangedFile } from '@shared/types'
import { Icon } from '../lib/icons'
import type { ContextMenuItem } from './ContextMenu'

/** Join the repo root and a repo-relative POSIX path into an absolute path. */
function fullPath(repoPath: string, rel: string): string {
  return `${repoPath.replace(/\/+$/, '')}/${rel}`
}

/** Context-menu items that copy the selection's relative and full paths. */
export function copyPathItems(files: ChangedFile[], repoPath: string): ContextMenuItem[] {
  const plural = files.length > 1
  return [
    {
      label: plural ? 'Copy Relative Paths' : 'Copy Relative Path',
      icon: <Icon.Copy size={15} />,
      onClick: () => window.gitgrove.clipboardWrite(files.map((f) => f.path).join('\n'))
    },
    {
      label: plural ? 'Copy Full Paths' : 'Copy Full Path',
      icon: <Icon.Copy size={15} />,
      onClick: () =>
        window.gitgrove.clipboardWrite(files.map((f) => fullPath(repoPath, f.path)).join('\n'))
    }
  ]
}
