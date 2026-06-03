// Sanitiser for electron-updater failures. Kept dependency-free (no electron
// imports) so it stays unit-testable and can never leak raw transport details
// into the UI.

/**
 * Turn electron-updater's raw failure into a short, safe, user-facing line.
 *
 * Its errors are notoriously hostile: a 404 arrives as the whole HTTP response —
 * request line, status, *and every response header, including Set-Cookie session
 * tokens*. Forwarding that verbatim both wrecks the layout and leaks secrets, so
 * we map known cases to a sentence and otherwise keep only the first clause.
 */
export function describeUpdateError(err: unknown): string {
  const code = (err as { code?: string })?.code
  const statusCode = (err as { statusCode?: number })?.statusCode
  const raw = err instanceof Error ? err.message : String(err ?? '')

  // Offline / DNS / connection problems.
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    /net::|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)
  ) {
    return "Couldn't reach the update server. Check your connection and try again."
  }

  // 404 means there's no published release to update from yet (e.g. only a draft).
  if (statusCode === 404 || /\b404\b/.test(raw)) {
    return 'No published release is available to update from yet.'
  }

  // Anything else: keep only the first clause, never the headers, and cap length.
  const clean =
    raw
      .split(/Headers:|\r\n|\n/)[0]
      ?.replace(/^[A-Za-z]*Error:\s*/, '')
      .trim() || 'unknown error'
  return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean
}
