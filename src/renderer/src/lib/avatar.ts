// Helpers for rendering commit author avatars. Gravatar supports SHA-256
// hashes of the lowercased, trimmed email, which we can compute with the
// browser's SubtleCrypto (MD5 isn't available there). `d=404` makes Gravatar
// 404 when the author has no avatar so the UI can fall back to initials.

const hashCache = new Map<string, Promise<string>>()

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)).then((buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}

export function gravatarUrl(email: string, size = 80): Promise<string> {
  const key = email.trim().toLowerCase()
  let hash = hashCache.get(key)
  if (!hash) {
    hash = sha256Hex(key)
    hashCache.set(key, hash)
  }
  return hash.then((h) => `https://gravatar.com/avatar/${h}?s=${size}&d=404`)
}

/** Up to two initials from an author name, falling back to the email. */
export function initials(name: string, email = ''): string {
  const source = name.trim() || email.trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic, pleasant background color for an initials avatar. */
export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 52% 48%)`
}
