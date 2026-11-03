import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { SystemAlertBanner } from './SystemAlertBanner'
import { DailyBackupAlertBanner } from './DailyBackupAlertBanner'
import { SidebarWeather } from './SidebarWeather'
import { NetworkSelector } from './NetworkSelector'
import { AppInfoModal } from './AppInfoModal'
import { GoogleDriveSetupModal } from './GoogleDriveSetupModal'
import { useConfirm } from '../../context/ConfirmContext'
import { useAppState } from '../../context/AppStateContext'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION } from '../../lib/appVersion'
import { bindAppShortcuts } from '../../lib/appShortcuts'
import { exitApp } from '../../lib/exitApp'
import {
  getGoogleDriveStatus,
  needsGoogleDriveSetup,
} from '../../lib/googleDrive'
import type { AppSettings } from '../../types'
import logoUrl from '../../assets/Logo.jpeg?url'
import './layout.css'

const ALL_LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/pacientes', label: 'Pacientes' },
  { to: '/medicos', label: 'Médicos' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/pagos', label: 'Pagos' },
  { to: '/pagos-cancelados', label: 'Pagos Cancelados' },
  { to: '/afiliados', label: 'Afiliados' },
  { to: '/configuracion', label: 'Configuración' },
  { to: '/mantenimiento', label: 'Mantenimiento' },
]

function SidebarGoogleDrive() {
  const { data } = useAppState()
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    void getGoogleDriveStatus(data.settings)
      .then((status) => setAvailable(status?.available ?? false))
      .catch(() => setAvailable(false))
  }, [
    data.settings.rutaGoogleDriveCustom,
    data.settings.googleDriveDeshabilitado,
  ])

  if (available === null) return null

  const title = available
    ? 'Google Drive activo en esta PC'
    : data.settings.googleDriveDeshabilitado
      ? 'Google Drive desactivado'
      : 'Google Drive no detectado'

  return (
    <div className="sidebar-gd" title={title}>
      <span className={`sidebar-gd__dot ${available ? 'sidebar-gd__dot--ok' : 'sidebar-gd__dot--err'}`} />
      Google Drive
    </div>
  )
}

export function Layout() {
  const {
    data,
    updateSettings,
    requestExit,
    systemAlert,
    dismissSystemAlert,
    dailyBackupAlert,
    dismissDailyBackupAlert,
    retryDailyBackup,
  } = useAppState()
  const { session, logout, canAccessPath } = useAuth()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [infoOpen, setInfoOpen] = useState(false)
  const [salirBusy, setSalirBusy] = useState(false)
  const [dailyBackupRetryBusy, setDailyBackupRetryBusy] = useState(false)

  const showGoogleDriveSetup =
    isTauri() && needsGoogleDriveSetup(data.settings)

  const handleGoogleDriveSetup = useCallback(
    (patch: Partial<AppSettings>) => {
      updateSettings({
        ...patch,
        googleDriveSetupCompletado: true,
      })
    },
    [updateSettings],
  )

  const openInfo = useCallback(() => setInfoOpen(true), [])
  const closeInfo = useCallback(() => setInfoOpen(false), [])

  useEffect(() => {
    return bindAppShortcuts(navigate, canAccessPath, openInfo)
  }, [navigate, canAccessPath, openInfo])

  const links = ALL_LINKS.filter((l) => canAccessPath(l.to))

  async function handleSalir() {
    if (salirBusy) return
    setSalirBusy(true)
    try {
      if (await requestExit()) {
        await exitApp()
      }
    } catch (err) {
      console.error('[salir]', err)
      void confirm({
        titleLogo: true,
        message: 'No se pudo cerrar la aplicación. Probá de nuevo.',
      })
    } finally {
      setSalirBusy(false)
    }
  }

  function handleCerrarSesion() {
    logout()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menú principal">
        <div className="sidebar-brand" data-tauri-drag-region>
          <div className="sidebar-brand__logo-wrap">
            <img
              src={logoUrl}
              alt=""
              className="sidebar-logo"
              width={120}
              height={120}
              draggable={false}
            />
          </div>
        </div>
        <p className="sidebar-user" title={session.displayName} data-role={session.role}>
          {session.username}
        </p>
        <nav className="sidebar-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={Boolean(l.end)}
              className={({ isActive }) =>
                `nav-item${isActive ? ' nav-item--active' : ''}`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <button
            type="button"
            className="nav-item nav-item--session"
            onClick={handleCerrarSesion}
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            className="nav-item nav-item--salir"
            disabled={salirBusy}
            onClick={() => void handleSalir()}
          >
            {salirBusy ? 'Saliendo…' : 'Salir'}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <SidebarWeather />
          <NetworkSelector />
          <SidebarGoogleDrive />
          <button
            type="button"
            className="sidebar-version"
            title="Versión y atajos (F1)"
            onClick={openInfo}
          >
            v{APP_VERSION} · F1 ayuda
          </button>
        </div>
      </aside>
      <main className="main-area">
        {infoOpen && (
          <AppInfoModal onClose={closeInfo} canAccessPath={canAccessPath} />
        )}
        {showGoogleDriveSetup && (
          <GoogleDriveSetupModal
            settings={data.settings}
            onConfirm={handleGoogleDriveSetup}
          />
        )}
        {dailyBackupAlert && (
          <DailyBackupAlertBanner
            message={dailyBackupAlert.message}
            retryBusy={dailyBackupRetryBusy}
            onRetry={() => {
              setDailyBackupRetryBusy(true)
              void retryDailyBackup().finally(() => setDailyBackupRetryBusy(false))
            }}
            onDismiss={dismissDailyBackupAlert}
          />
        )}
        {systemAlert && (
          <SystemAlertBanner
            message={systemAlert}
            onDismiss={dismissSystemAlert}
          />
        )}
        <Outlet />
      </main>
    </div>
  )
}
