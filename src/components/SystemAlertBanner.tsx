import { useEffect } from 'react'
import './system-alert.css'

type Props = {
  message: string
  onDismiss: () => void
}

const AUTO_DISMISS_MS = 14_000

export function SystemAlertBanner({ message, onDismiss }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(id)
  }, [message, onDismiss])

  return (
    <div className="system-alert" role="alert">
      <p className="system-alert__text">{message}</p>
      <button
        type="button"
        className="system-alert__close"
        aria-label="Cerrar aviso"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}
