import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  getGoogleDriveStatus,
  googleDriveStatusLabel,
  googleDriveStatusTone,
  pickGoogleDriveFolder,
  type GoogleDriveStatus,
} from '../../lib/googleDrive'
import type { AppSettings } from '../../types'
import './google-drive-setup-modal.css'

type Props = {
  settings: AppSettings
  onConfirm: (patch: Partial<AppSettings>) => void
}

export function GoogleDriveSetupModal({ settings, onConfirm }: Props) {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    void getGoogleDriveStatus(settings)
      .then(setStatus)
      .finally(() => setLoading(false))
  }, [settings.rutaGoogleDriveCustom, settings.googleDriveDeshabilitado])

  async function handlePickOther() {
    setPicking(true)
    try {
      const picked = await pickGoogleDriveFolder()
      if (!picked) return
      onConfirm({
        rutaGoogleDriveCustom: picked,
        googleDriveDeshabilitado: false,
        googleDriveSetupCompletado: true,
      })
    } finally {
      setPicking(false)
    }
  }

  function handleUseDetected() {
    onConfirm({
      rutaGoogleDriveCustom: undefined,
      googleDriveDeshabilitado: false,
      googleDriveSetupCompletado: true,
    })
  }

  function handleSkip() {
    onConfirm({
      googleDriveDeshabilitado: true,
      googleDriveSetupCompletado: true,
    })
  }

  const tone = status ? googleDriveStatusTone(status) : 'warn'
  const detected = status?.detectedPath

  return (
    <div className="gd-setup-backdrop" role="presentation">
      <div
        className="gd-setup-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gd-setup-title"
      >
        <header className="gd-setup-sheet__head">
          <div>
            <h2 id="gd-setup-title">Google Drive en esta PC</h2>
            <p className="gd-setup-sheet__sub">
              Los respaldos y exportaciones pueden copiarse a la carpeta local de Google Drive
              para sincronizar en la nube.
            </p>
          </div>
        </header>

        <div className="gd-setup-sheet__body">
          {loading ? (
            <p className="gd-setup-loading">Detectando Google Drive…</p>
          ) : (
            <>
              <div className={`gd-setup-status gd-setup-status--${tone}`}>
                <span className="gd-setup-status__dot" aria-hidden />
                <div>
                  <strong>
                    {status?.available
                      ? 'Google Drive detectado'
                      : 'Google Drive no detectado'}
                  </strong>
                  {status && (
                    <p className="gd-setup-status__path">
                      {googleDriveStatusLabel(status)}
                    </p>
                  )}
                </div>
              </div>

              <p className="gd-setup-hint">
                En cada computadora la ruta puede ser distinta. Podés usar la carpeta detectada,
                elegir otra manualmente o continuar sin Google Drive.
              </p>

              <ul className="gd-setup-defaults">
                <li>Respaldo BD → carpeta <strong>Backup Agenda</strong></li>
                <li>Excel gerencia → carpeta <strong>Exportar</strong></li>
                <li>PDFs → carpeta <strong>PDFs</strong></li>
              </ul>
              <p className="gd-setup-hint gd-setup-hint--small">
                Los nombres de subcarpeta se pueden cambiar después en Configuración.
              </p>
            </>
          )}
        </div>

        <footer className="gd-setup-sheet__foot">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || picking}
            onClick={handleSkip}
          >
            No usar Drive
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || picking}
            onClick={() => void handlePickOther()}
          >
            {picking ? 'Abriendo…' : 'Elegir otra carpeta'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || picking || !detected}
            onClick={handleUseDetected}
          >
            Usar carpeta detectada
          </button>
        </footer>
      </div>
    </div>
  )
}
