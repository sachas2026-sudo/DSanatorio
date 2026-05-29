import { useEffect } from 'react'
import { APP_VERSION } from '../lib/appVersion'
import { APP_SHORTCUTS } from '../lib/appShortcuts'
import { CHANGELOG } from '../lib/changelog'
import { brandGestiónLine } from '../lib/pdfBranding'
import './app-info-modal.css'

type Props = {
  onClose: () => void
  canAccessPath: (pathname: string) => boolean
}

export function AppInfoModal({ onClose, canAccessPath }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shortcuts = APP_SHORTCUTS.filter(
    (s) => !s.adminOnly || (s.path && canAccessPath(s.path)),
  )

  return (
    <div
      className="app-info-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="app-info-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-info-title"
      >
        <header className="app-info-sheet__head">
          <div>
            <h2 id="app-info-title">Acerca de</h2>
            <p className="app-info-sheet__sub">{brandGestiónLine()}</p>
          </div>
          <button
            type="button"
            className="app-info-sheet__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="app-info-sheet__body">
          <section className="app-info-section" aria-labelledby="app-info-version">
            <h3 id="app-info-version">Versión</h3>
            <p className="app-info-version">
              Instalada: <strong>v{APP_VERSION}</strong>
            </p>
          </section>

          <section className="app-info-section" aria-labelledby="app-info-shortcuts">
            <h3 id="app-info-shortcuts">Atajos de teclado</h3>
            <ul className="app-info-shortcuts">
              {shortcuts.map((s) => (
                <li key={s.keys}>
                  <span>{s.label}</span>
                  <kbd>{s.keys}</kbd>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-info-section" aria-labelledby="app-info-changelog">
            <h3 id="app-info-changelog">Novedades</h3>
            <ul className="app-info-changelog">
              {CHANGELOG.map((entry) => (
                <li key={entry.version} className="app-info-changelog__entry">
                  <div className="app-info-changelog__head">
                    <span className="app-info-changelog__version">
                      v{entry.version}
                    </span>
                    <span className="app-info-changelog__date">{entry.date}</span>
                  </div>
                  <ul>
                    {entry.highlights.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
