// Pure helpers about git host names, shared by the main process (accounts
// store, GitHub provider) and the renderer (sign-in forms). No runtime
// dependencies — importable from every bundle, directly unit-testable.

/**
 * Hosts are compared case-insensitively (DNS is); the port, when present,
 * stays significant — two GHES instances can share a name behind ports.
 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

/**
 * The host out of whatever the user pastes into a server field — a bare host,
 * a full clone/web URL, host:port — or null when nothing host-like is there.
 */
export function hostFromInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    return url.host ? normalizeHost(url.host) : null
  } catch {
    return null
  }
}

export function isGitHubDotCom(host: string): boolean {
  return normalizeHost(host) === 'github.com'
}

/**
 * Deep link for the guided token path: opens the host's "new token" page with
 * the scopes git pushing needs preselected (`repo` + `workflow`) — the
 * browser session already has the user signed in, so it's generate → copy →
 * paste.
 */
export function tokenCreationUrl(host: string): string {
  return `https://${normalizeHost(host)}/settings/tokens/new?scopes=repo,workflow&description=GitGrove`
}
