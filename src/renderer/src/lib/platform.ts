// Host platform, surfaced synchronously by the preload bridge so the UI can lay
// out its title bar correctly on the very first render (macOS keeps the native
// inset traffic lights; Windows/Linux get custom window controls instead).

export const platform: NodeJS.Platform = window.gitgrove?.platform ?? 'darwin'

export const isMac = platform === 'darwin'

/** Reflect the platform onto <html data-platform> so CSS can branch on it. */
export function applyPlatform(): void {
  document.documentElement.dataset.platform = platform
}
