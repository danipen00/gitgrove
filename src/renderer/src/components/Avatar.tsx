import { useEffect, useState } from 'react'

import { avatarColor, gravatarUrl, initials } from '../lib/avatar'

interface Props {
  name: string
  email: string
  size?: number
}

/** Round author avatar: Gravatar when available, deterministic initials otherwise. */
export function Avatar({ name, email, size = 28 }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setFailed(false)
    if (email.trim()) {
      gravatarUrl(email, size * 2).then((url) => {
        if (alive) setSrc(url)
      })
    }
    return () => {
      alive = false
    }
  }, [email, size])

  const showImage = src && !failed

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: showImage ? undefined : avatarColor(email || name)
      }}
      title={name}
    >
      {showImage ? (
        <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} />
      ) : (
        initials(name, email)
      )}
    </span>
  )
}
