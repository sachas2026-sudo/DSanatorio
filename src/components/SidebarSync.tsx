import { format } from 'date-fns'
import { useAppState } from '../context/AppStateContext'
import './sidebar-sync.css'

export function SidebarSync() {
  const { syncData, syncBusy, lastSyncTime } = useAppState()

  const handleSync = async () => {
    if (syncBusy) return
    await syncData(false)
  }

  const timeLabel = lastSyncTime ? format(lastSyncTime, 'HH:mm:ss') : '--:--:--'

  return (
    <button
      type="button"
      className={`sidebar-sync-btn ${syncBusy ? 'is-syncing' : ''}`}
      onClick={() => void handleSync()}
      disabled={syncBusy}
      title="Sincronizar datos con la red"
      aria-label="Sincronizar datos"
    >
      <div className="sidebar-sync-left">
        <svg
          className={`sidebar-sync-icon ${syncBusy ? 'spin-anim' : ''}`}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--menu-acento, #2F7BD6)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <span className="sidebar-sync-text">
          {syncBusy ? 'Sincronizando...' : 'Sincronizar'}
        </span>
      </div>
      <span className="sidebar-sync-time">{timeLabel}</span>
    </button>
  )
}
