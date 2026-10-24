import './system-alert.css'

type Props = {
  message: string
  onRetry: () => void
  onDismiss: () => void
  retryBusy?: boolean
}

export function DailyBackupAlertBanner({
  message,
  onRetry,
  onDismiss,
  retryBusy = false,
}: Props) {
  return (
    <div className="system-alert system-alert--daily-backup" role="alert">
      <p className="system-alert__text">
        <strong>Respaldo diario:</strong> {message}
      </p>
      <div className="system-alert__actions">
        <button
          type="button"
          className="system-alert__action"
          disabled={retryBusy}
          onClick={onRetry}
        >
          {retryBusy ? 'Reintentando…' : 'Reintentar ahora'}
        </button>
        <button
          type="button"
          className="system-alert__close"
          aria-label="Cerrar aviso"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
    </div>
  )
}
