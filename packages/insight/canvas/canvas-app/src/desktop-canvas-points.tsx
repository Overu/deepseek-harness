/** Remaining account points from the same store used by Canvas generation. */
import { useEffect } from 'react'
import { usePointStore } from '../legacy/src/store/pointStore'
import pointIcon from '../legacy/src/assets/images/point.png'
import { useAuth } from './auth-context'
import { canvasPointsCopy as copy } from './locales'

/**
 * Displays an icon and the last successful balance; click to refresh or retry.
 * @returns The balance control, or null when the desktop account is signed out.
 */
export default function DesktopCanvasPoints() {
  const { authStatus } = useAuth()
  const point = usePointStore(state => state.point)
  const loading = usePointStore(state => state.pointLoading)
  const error = usePointStore(state => state.pointError)
  const lastSuccessAt = usePointStore(state => state.lastSuccessAt)
  const refresh = usePointStore(state => state.actions.refreshUserPoint)

  useEffect(() => {
    if (authStatus.status === 'logged_in') void refresh({ reason: 'display' })
  }, [authStatus.status, refresh])

  if (authStatus.status !== 'logged_in') return null

  return <button type="button" aria-label={error ? copy.retry : copy.refresh} aria-busy={loading} disabled={loading}
    onClick={() => void refresh({ reason: 'manual' })}
    className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2 rounded-full bg-white/25 px-3 py-1 text-sm text-white backdrop-blur-md enabled:hover:bg-white/45 disabled:cursor-wait">
    <img src={pointIcon} alt="" className="h-4 w-4" />
    <span role="status">{lastSuccessAt !== null ? point.toLocaleString('en-US') : loading || !error ? '···' : '—'}</span>
  </button>
}
