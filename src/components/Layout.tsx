import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { SystemAlertBanner } from './SystemAlertBanner'
import { DailyBackupAlertBanner } from './DailyBackupAlertBanner'
import { SidebarWeather } from './SidebarWeather'
import { NetworkSelector } from './NetworkSelector'
import { AppInfoModal } from './AppInfoModal'
import { ForcePasswordChange } from './ForcePasswordChange'
import { useConfirm } from '../context/ConfirmContext'
import { useAppState } from '../context/AppStateContext'
import { useAuth } from '../context/AuthContext'
import { APP_VERSION } from '../lib/appVersion'
import { bindAppShortcuts } from '../lib/appShortcuts'
import { exitApp } from '../lib/exitApp'
import logoUrl from '../assets/Logo.jpeg?url'
import './layout.css'

const ALL_LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/pacientes', label: 'Pacientes' },
  { to: '/medicos', label: 'Médicos' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/pagos', label: 'Pagos' },
  { to: '/pagos-cancelados', label: 'Pagos Cancelados' },
  { to: '/configuracion', label: 'Configuración' },
  { to: '/mantenimiento', label: 'Mantenimiento' },
]

export function Layout() {
  const {
    requestExit,
    systemAlert,
    dismissSystemAlert,
    dailyBackupAlert,
    dismissDailyBackupAlert,
    retryDailyBackup,
  } = useAppState()
  const { session, logout, canAccessPath } = useAuth()
  const location = useLocation()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [infoOpen, setInfoOpen] = useState(false)
  const [salirBusy, setSalirBusy] = useState(false)
  const [dailyBackupRetryBusy, setDailyBackupRetryBusy] = useState(false)

  const openInfo = useCallback(() => setInfoOpen(true), [])
  const closeInfo = useCallback(() => setInfoOpen(false), [])

  useEffect(() => {
    return bindAppShortcuts(navigate, canAccessPath, openInfo)
  }, [navigate, canAccessPath, openInfo])

  useEffect(() => {
    if (session?.role === 'afiliado' && location.pathname === '/') {
      navigate('/afiliados', { replace: true })
    }
  }, [session, location.pathname, navigate])

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

  if (session?.mustChangePassword) {
    return <ForcePasswordChange />
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
        <p className="sidebar-user" title={session.username} data-role={session.role}>
          {session.displayName}
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
