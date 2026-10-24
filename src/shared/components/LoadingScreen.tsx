import { APP_DISPLAY_NAME } from '../../lib/pdfBranding'
import './loading-screen.css'

type Props = {
  exiting?: boolean
}

export function LoadingScreen({ exiting = false }: Props) {
  return (
    <div
      className={`loading-screen${exiting ? ' loading-screen--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
      aria-label={`Cargando ${APP_DISPLAY_NAME}`}
    >
      <div className="loading-screen__inner">
        <div className="loading-ring" aria-hidden>
          <div className="loading-ring__track" />
          <div className="loading-ring__spin" />
        </div>
        <p className="loading-screen__title">{APP_DISPLAY_NAME}</p>
        <p className="loading-screen__hint">Cargando…</p>
      </div>
    </div>
  )
}
