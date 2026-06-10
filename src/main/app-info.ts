import { app } from 'electron'
import type { AppInfo } from '@shared/types'

export const REPO_URL = 'https://github.com/danipen/gitgrove'

export function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    dev: !app.isPackaged,
    repoUrl: REPO_URL
  }
}
