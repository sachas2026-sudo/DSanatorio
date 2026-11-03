import { useState } from 'react'
import { format } from 'date-fns'
import { useAppState } from '../context/AppStateContext'
import './sidebar-sync.css'

export function SidebarSync() {
  const { syncData, syncBusy, lastSyncTime } = useAppState()
  const [feedback, setFeedback] = useState<string | null>(null)

  const handleSync = async () => {
    if (syncBusy) return
    const success = await syncData(false)
    if (success) {
      setFeedback('¡Sincronizado!')
      setTimeout(() => setFeedback(null), 2500)
    } else {
      setFeedback('Sin cambios')
      setTimeout(() => setFeedback(null), 2500)
    }
  }

  const timeLabel = lastSyncTime ? format(lastSyncTime, 'HH:mm:ss') : null
  const tooltipText = lastSyncTime
    ? `Última sincronización con la red: ${timeLabel}. Clic para sincronizar ahora.`
    : 'Clic para sincronizar con la red local ahora (auto-sync activo cada 12s).'

  return (
    <button
      type="button"
      className={`sidebar-sync-btn ${syncBusy ? 'is-syncing' : ''}`}
      onClick={() => void handleSync()}
      disabled={syncBusy}
      title={tooltipText}
      aria-label="Sincronizar datos con la red"
    >
      <span className="sidebar-sync-icon-wrap">
        <svg
          className={`sidebar-sync-icon ${syncBusy ? 'spin-anim' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </span>
      <div className="sidebar-sync-info">
        <span className="sidebar-sync-label">
          {syncBusy ? 'Sincronizando...' : (feedback ?? 'Sincronizar')}
        </span>
        {timeLabel && !syncBusy && !feedback && (
          <span className="sidebar-sync-sub" title={`Última vez: ${timeLabel}`}>
            {timeLabel}
          </span>
        )}
      </div>
    </button>
  )
}
