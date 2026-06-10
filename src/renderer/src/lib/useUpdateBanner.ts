// Auto-update UI state: subscribes to the updater's status stream and decides
// what the update banner shows. Two kinds of banner share one surface:
// download progress / "ready to restart" (sticky until dismissed, remembered
// per version so a deferred update doesn't nag), and the short-lived feedback
// for a *manual* "Check for Updates…" (up to date / error), which auto-hides.

import type { UpdateStatus } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'

/** How long manual-check feedback ("You're up to date") stays visible (ms). */
const FEEDBACK_DURATION = 5000

const isReady = (update: UpdateStatus) =>
  update.state === 'downloaded' || update.state === 'manual-install'

const isManualFeedback = (update: UpdateStatus) =>
  !!update.manual &&
  (update.state === 'checking' ||
    update.state === 'not-available' ||
    update.state === 'error' ||
    update.state === 'dev')

/**
 * What the banner shows for the current update state, or null for no banner.
 * A ready update stays visible until dismissed for exactly that version;
 * manual-check feedback hides once dismissed or while the About dialog is
 * open (it shows the same status itself). Pure + exported for tests.
 */
export function bannerUpdateFor(
  update: UpdateStatus | null,
  dismissedVersion: string | null,
  feedbackDismissed: boolean,
  aboutOpen: boolean
): UpdateStatus | null {
  if (!update) return null
  const deferred = isReady(update) && update.newVersion === dismissedVersion
  const isProgress =
    update.state === 'downloading' || update.state === 'available' || isReady(update)
  if (isProgress && !deferred) return update
  if (isManualFeedback(update) && !feedbackDismissed && !aboutOpen) return update
  return null
}

export function useUpdateBanner(aboutOpen: boolean, onError: (e: unknown) => void) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [feedbackDismissed, setFeedbackDismissed] = useState(false)

  useEffect(
    () =>
      window.gitgrove.onUpdateStatus((status) => {
        setUpdate(status)
        if (status.manual) setFeedbackDismissed(false)
        // A new version becoming ready supersedes an earlier dismissal.
        if (isReady(status) && status.newVersion !== dismissedVersion) setDismissedVersion(null)
      }),
    [dismissedVersion]
  )

  useEffect(() => {
    if (!update || !isManualFeedback(update) || feedbackDismissed) return
    if (update.state === 'checking') return
    const t = setTimeout(() => setFeedbackDismissed(true), FEEDBACK_DURATION)
    return () => clearTimeout(t)
  }, [update, feedbackDismissed])

  const dismiss = useCallback(() => {
    if (update && isReady(update)) setDismissedVersion(update.newVersion ?? null)
    else setFeedbackDismissed(true)
  }, [update])

  const check = useCallback(() => {
    window.gitgrove.checkForUpdates(true).catch(onError)
  }, [onError])

  const install = useCallback(() => {
    window.gitgrove.installUpdate().catch(onError)
  }, [onError])

  return {
    /** Latest raw status, for the About dialog. */
    update,
    /** What the banner shows right now, or null for no banner. */
    bannerUpdate: bannerUpdateFor(update, dismissedVersion, feedbackDismissed, aboutOpen),
    dismiss,
    check,
    install
  }
}
