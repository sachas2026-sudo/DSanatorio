import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { SystemAlertBanner } from './SystemAlertBanner'
import { SidebarWeather } from './SidebarWeather'
import { AppInfoModal } from './AppInfoModal'
import { useAppState } from '../context/AppStateContext'
import { useAuth } from '../context/AuthContext'
import { APP_VERSION } from '../lib/appVersion'
import { bindAppShortcuts } from '../lib/appShortcuts'
import { exitApp } from '../lib/exitApp'
import { APP_DISPLAY_NAME } from '../lib/pdfBranding'
import logoUrl from '../../Logo.jpeg?url'
import './layout.css'

const ALL_LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/pacientes', label: 'Pacientes' },
  { to: '/medicos', label: 'Médicos' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/pagos', label: 'Pagos' },
  { to: '/pagos-cancelados', label: 'Pagos Cancelados' },
  { to: '/configuracion', label: 'Configuración' },
]

export function Layout() {
  const { requestExit, systemAlert, dismissSystemAlert } = useAppState()
  const { session, logout, canAccessPath } = useAuth()
  const navigate = useNavigate()
  const [infoOpen, setInfoOpen] = useState(false)

  const openInfo = useCallback(() => setInfoOpen(true), [])
  const closeInfo = useCallback(() => setInfoOpen(false), [])

  useEffect(() => {
    return bindAppShortcuts(navigate, canAccessPath, openInfo)
  }, [navigate, canAccessPath, openInfo])

  const links = ALL_LINKS.filter((l) => canAccessPath(l.to))

  async function handleSalir() {
    if (await requestExit()) {
      await exitApp()
    }
  }

  function handleCerrarSesion() {
    logout()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menú principal">
        <div className="sidebar-brand" data-tauri-drag-region>
          <img
            src={logoUrl}
            alt=""
            className="sidebar-logo"
            width={68}
            height={68}
            draggable={false}
          />
          <div>
            <div className="sidebar-title">{APP_DISPLAY_NAME}</div>
            <div className="sidebar-sub">Gestión clínica</div>
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
            onClick={() => void handleSalir()}
          >
            Salir
          </button>
        </nav>
        <div className="sidebar-bottom">
          <SidebarWeather />
          <button
            type="button"
            className="sidebar-version"
            title="Versión, novedades y atajos (F1)"
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
