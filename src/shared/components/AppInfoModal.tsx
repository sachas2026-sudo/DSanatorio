import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { APP_VERSION } from '../../lib/appVersion'
import { APP_SHORTCUTS } from '../../lib/appShortcuts'
import {
  DAILY_BACKUP_SUBDIR,
  DATA_FILE_NAME,
  ROTATING_BACKUP_FILENAMES,
  dailyBackupFilename,
  getBackupLocations,
} from '../../lib/appBackup'
import { getInstallInfo } from '../../lib/installInfo'
import { brandGestiónLine } from '../../lib/pdfBranding'
import './app-info-modal.css'

const DEFAULT_DATA_DIR = 'C:\\Sanatorio\\datos'
const DEFAULT_BACKUP_DIR = 'C:\\Sanatorio\\respaldo'

type Props = {
  onClose: () => void
  canAccessPath: (pathname: string) => boolean
}

export function AppInfoModal({ onClose, canAccessPath }: Props) {
  const [dataDir, setDataDir] = useState(DEFAULT_DATA_DIR)
  const [backupLocations, setBackupLocations] = useState<string[]>([
    DEFAULT_BACKUP_DIR,
  ])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!isTauri()) return
    void getInstallInfo().then((info) => {
      if (info?.dataDir) setDataDir(info.dataDir)
    })
    void getBackupLocations().then((paths) => {
      if (paths.length > 0) setBackupLocations(paths)
    })
  }, [])

  const shortcuts = APP_SHORTCUTS.filter(
    (s) => !s.adminOnly || (s.path && canAccessPath(s.path)),
  )

  const primaryBackupDir =
    backupLocations[0] ?? DEFAULT_BACKUP_DIR

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
          <div className="app-info-sheet__head-text">
            <h2 id="app-info-title">Acerca de</h2>
            <p className="app-info-sheet__sub">{brandGestiónLine()}</p>
          </div>
          <button
            type="button"
            className="app-info-sheet__cerrar"
            onClick={onClose}
          >
            Cerrar
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

          <section className="app-info-section" aria-labelledby="app-info-backups">
            <h3 id="app-info-backups">Respaldos de la base de datos</h3>
            <p className="app-info-backup-text">
              Base activa:{' '}
              <code className="app-info-backup-path">
                {dataDir}\{DATA_FILE_NAME}
              </code>
            </p>
            <p className="app-info-backup-text">
              Al salir o con <strong>Copia ahora</strong> se rotan{' '}
              <strong>3 copias</strong> en PC, en <strong>otro disco</strong> si
              la computadora tiene (D:, E:, …) y en Dropbox si está instalado.
              Una vez al día (con la app abierta) se guarda además una copia
              fechada en la carpeta <code>diario</code>.
            </p>
            <p className="app-info-backup-text">
              Cada copia rotativa incluye la base (pacientes, turnos, pagos,
              agenda, configuración) y archivos aparte de{' '}
              <strong>usuarios/contraseñas</strong> y{' '}
              <strong>clave SMTP</strong> en la misma carpeta:
            </p>
            <ul className="app-info-backup-paths">
              {backupLocations.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
            <p className="app-info-backup-text">
              Nombre de cada copia de resguardo en esas carpetas:
            </p>
            <ul className="app-info-backup-files">
              {ROTATING_BACKUP_FILENAMES.map((name, i) => (
                <li key={name}>
                  <code>{name}</code>
                  {i === 0 && ' — más reciente'}
                  {i === 2 && ' — más antigua'}
                </li>
              ))}
            </ul>
            <p className="app-info-backup-text">
              Respaldos diarios (60 días):{' '}
              <code className="app-info-backup-path">
                {primaryBackupDir}\{DAILY_BACKUP_SUBDIR}\
              </code>
              {' '}
              (<code>{dailyBackupFilename('YYYY-MM-DD')}</code>)
            </p>
            <p className="app-info-backup-tip" role="note">
              <strong>Recomendación:</strong> copie también estas carpetas en otra
              unidad (otro disco, pendrive o nube distinta) para proteger los datos
              si falla el equipo.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
