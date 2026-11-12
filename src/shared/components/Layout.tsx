import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { SystemAlertBanner } from './SystemAlertBanner'
import { DailyBackupAlertBanner } from './DailyBackupAlertBanner'
import { SidebarWeather } from './SidebarWeather'
import { SidebarSync } from './SidebarSync'
import { NetworkSelector } from './NetworkSelector'
import { AppInfoModal } from './AppInfoModal'
import { GoogleDriveSetupModal } from './GoogleDriveSetupModal'
import { useConfirm } from '../../context/ConfirmContext'
import { useAppState } from '../../context/AppStateContext'
import { useAuth } from '../../context/AuthContext'
import { bindAppShortcuts } from '../../lib/appShortcuts'
import { exitApp } from '../../lib/exitApp'
import { getGoogleDriveStatus } from '../../lib/googleDrive'
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
  { to: '/pagos-afiliados', label: 'Pagos de afiliados' },
  { to: '/configuracion', label: 'Configuración' },
  { to: '/mantenimiento', label: 'Mantenimiento' },
]

function getNavIcon(to: string) {
  switch (to) {
    case '/':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" />
        </svg>
      )
    case '/pacientes':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case '/medicos':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3" />
          <path d="M9 12.5v3.5a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4v-1.5" />
          <circle cx="18" cy="10" r="2.5" />
          <line x1="3" y1="3" x2="6" y2="3" />
          <line x1="12" y1="3" x2="15" y2="3" />
        </svg>
      )
    case '/agenda':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    case '/pagos':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      )
    case '/pagos-cancelados':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
          <line x1="14" y1="13" x2="18" y2="17" />
          <line x1="18" y1="13" x2="14" y2="17" />
        </svg>
      )
    case '/afiliados':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="10" r="2" />
          <line x1="14" y1="9" x2="17.5" y2="9" />
          <line x1="14" y1="13" x2="17.5" y2="13" />
          <path d="M5.5 16c0-1.5 1.5-2 3-2s3 .5 3 2" />
        </svg>
      )
    case '/pagos-afiliados':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="6" width="20" height="13" rx="2" />
          <path d="M2 10h20" />
          <circle cx="16.5" cy="14.5" r="1.3" />
          <path d="M6 15h4" />
        </svg>
      )
    case '/configuracion':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    case '/mantenimiento':
      return (
        <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    default:
      return null
  }
}

function SidebarGoogleDrive({ onClick }: { onClick?: () => void }) {
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

  const isConnected = available === true

  return (
    <div
      className="sidebar-drive-row"
      title={isConnected ? 'Google Drive conectado' : 'Google Drive no conectado'}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <span
        className="sidebar-drive-dot"
        style={{
          backgroundColor: isConnected
            ? 'var(--menu-ok, #2E7D4F)'
            : 'var(--menu-error, #E5484D)',
        }}
        aria-hidden="true"
      />
      <span className="sidebar-drive-text">Google Drive</span>
    </div>
  )
}

export function Layout() {
  const { session, logout, canAccessPath } = useAuth()
  const {
    requestExit,
    systemAlert,
    dismissSystemAlert,
    dailyBackupAlert,
    dismissDailyBackupAlert,
    retryDailyBackup,
    data,
    updateSettings,
  } = useAppState()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [infoOpen, setInfoOpen] = useState(false)
  const [salirBusy, setSalirBusy] = useState(false)
  const [dailyBackupRetryBusy, setDailyBackupRetryBusy] = useState(false)
  const [showGoogleDriveSetup, setShowGoogleDriveSetup] = useState(false)

  const openInfo = useCallback(() => setInfoOpen(true), [])
  const closeInfo = useCallback(() => setInfoOpen(false), [])

  useEffect(() => {
    return bindAppShortcuts(navigate, canAccessPath, openInfo)
  }, [openInfo, canAccessPath, navigate])

  const handleGoogleDriveSetup = (patch: Partial<AppSettings>) => {
    updateSettings(patch)
    setShowGoogleDriveSetup(false)
  }

  if (!session) return null

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

  const displayName = session.displayName?.trim() || session.username
  const isAffiliate = session.role === 'afiliado'

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menú principal">
        {/* ENCABEZADO */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img
              src={logoUrl}
              alt="Cuidar Centro Médico"
              className="sidebar-logo"
              draggable={false}
            />
          </div>
          <p className="sidebar-user" title={displayName}>
            {displayName}
          </p>
        </div>

        {/* OPCIONES DEL MENÚ */}
        <nav className="sidebar-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={Boolean(l.end)}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? ' sidebar-nav-item--active' : ''}`
              }
            >
              {getNavIcon(l.to)}
              <span>{l.label}</span>
            </NavLink>
          ))}

          {/* Separador de 1px var(--menu-separador) con 10px de margen arriba y 6px abajo */}
          <div className="sidebar-menu-divider" />

          {/* CUENTA */}
          <div className="sidebar-account-section">
            {!isAffiliate && (
              <button
                type="button"
                className="sidebar-account-btn sidebar-account-btn--session"
                onClick={handleCerrarSesion}
              >
                <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Cerrar sesión</span>
              </button>
            )}
            <button
              type="button"
              className="sidebar-account-btn sidebar-account-btn--salir"
              disabled={salirBusy}
              onClick={() => void handleSalir()}
            >
              <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
              <span>{salirBusy ? 'Saliendo…' : 'Salir'}</span>
            </button>
          </div>
        </nav>

        {/* PIE */}
        {!isAffiliate && (
          <div className="sidebar-bottom">
            <SidebarSync />

          <SidebarWeather />

          <NetworkSelector onOpenInfo={openInfo} />

          <SidebarGoogleDrive onClick={() => setShowGoogleDriveSetup(true)} />
          </div>
        )}
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
