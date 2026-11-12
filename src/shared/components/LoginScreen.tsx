import { useState, useRef, useEffect, type FormEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  getDefaultLoginUsername,
  getLoginUserOptions,
  getLoginUserOptionsForInstallProfile,
  formatLoginRateLimitMessage,
  type LoginAttemptResult,
} from '../../lib/auth'
import { exitApp } from '../../lib/exitApp'
import { APP_VERSION } from '../../lib/appVersion'
import { isClientMode } from '../../lib/appMode'
import {
  discoverServers,
  getNetworkConnectionStatus,
  requestClientDeviceAccess,
  setManualServerUrl,
  type DiscoveredServer,
  type ClientDeviceAccessInfo,
  type NetworkStatusInfo,
} from '../../lib/networkDiscovery'
import logoUrl from '../../assets/Logo.jpeg?url'
import './login-screen.css'

type Props = {
  onSuccess: (
    username: string,
    password: string,
  ) => Promise<LoginAttemptResult>
}

export function LoginScreen({ onSuccess }: Props) {
  const [username, setUsername] = useState(getDefaultLoginUsername())
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [showNetModal, setShowNetModal] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [installProfile, setInstallProfile] = useState<string | null>(null)
  const [profileReady, setProfileReady] = useState(!isTauri())
  const [profileError, setProfileError] = useState<string | null>(null)
  const [manualIp, setManualIp] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusInfo | null>(null)
  const [deviceAccess, setDeviceAccess] = useState<ClientDeviceAccessInfo | null>(null)
  const [manualStatus, setManualStatus] = useState<{ type: 'ok' | 'err' | 'connecting'; text: string } | null>(null)
  const userOptions = isTauri()
    ? profileReady
      ? getLoginUserOptionsForInstallProfile(installProfile)
      : []
    : getLoginUserOptions()
  const userButtonRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!isTauri()) return
    let active = true
    void invoke<string | null>('get_install_profile')
      .then((profile) => {
        if (!active) return
        const options = getLoginUserOptionsForInstallProfile(profile)
        setInstallProfile(profile)
        setProfileError(
          options.length > 0
            ? null
            : 'No se pudo determinar el perfil de esta instalación. No se mostrarán cuentas de otros equipos.',
        )
        if (options[0]) setUsername(options[0])
        setProfileReady(true)
      })
      .catch((err) => {
        if (!active) return
        console.error('No se pudo leer el perfil de instalación:', err)
        setProfileError('No se pudo verificar el perfil instalado. No se mostrarán cuentas de otros equipos.')
        setProfileReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    isClientMode().then((client) => {
      setIsClient(client)
    }).catch(() => {
      setIsClient(false)
    })
  }, [])

  useEffect(() => {
    if (!isClient) return
    let active = true
    void getNetworkConnectionStatus()
      .then((status) => {
        if (!active) return
        setNetworkStatus(status)
        if (status.serverUrl) {
          setManualIp(status.serverUrl.replace(/^https:\/\//, ''))
        }
        if (status.isOnline) {
          void requestClientDeviceAccess('')
            .then(setDeviceAccess)
            .catch((err: unknown) => setManualStatus({
              type: 'err',
              text: typeof err === 'string' ? err : 'No se pudo consultar la autorización del dispositivo.',
            }))
        }
      })
      .catch((err) => {
        if (active) setManualStatus({ type: 'err', text: typeof err === 'string' ? err : 'No se pudo comprobar el servidor.' })
      })
    return () => {
      active = false
    }
  }, [isClient])

  async function handleManualConnect() {
    const raw = manualIp.trim()
    if (!raw) {
      setManualStatus({ type: 'err', text: 'Ingresá la IP y el puerto HTTPS del servidor.' })
      return
    }
    const ipM = raw.match(
      /^(?:https:\/\/)?((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?::([0-9]{1,5}))?$/)
    if (!ipM) {
      setManualStatus({ type: 'err', text: 'Ingresá una IPv4 válida y, opcionalmente, el puerto.' })
      return
    }
    const target = `https://${ipM[1]}:${ipM[2] ?? '8787'}`
    setManualStatus({ type: 'connecting', text: 'Conectando...' })
    try {
      await setManualServerUrl(target)
      const info = await getNetworkConnectionStatus()
      setNetworkStatus(info)
      if (info.isOnline) {
        setDeviceAccess(await requestClientDeviceAccess(''))
        setManualStatus({ type: 'ok', text: `Conexión verificada en ${info.serverUrl ?? target}` })
      } else {
        setManualStatus({ type: 'err', text: info.message })
      }
    } catch (e) {
      setManualStatus({ type: 'err', text: typeof e === 'string' ? e : e instanceof Error ? e.message : 'No se pudo conectar.' })
    }
  }

  async function handleDiscover() {
    setScanning(true)
    setManualStatus({ type: 'connecting', text: 'Buscando servidores LAN por UDP 8788…' })
    try {
      const servers = await discoverServers(3000)
      setDiscoveredServers(servers)
      setManualStatus({
        type: servers.length ? 'ok' : 'err',
        text: servers.length
          ? `Encontrados ${servers.length} candidato(s). UDP solo localiza equipos; la identidad se verifica con TLS.`
          : 'No se encontraron servidores por UDP. Podés ingresar IP y puerto manualmente.',
      })
    } catch (e) {
      setManualStatus({ type: 'err', text: typeof e === 'string' ? e : 'Falló la búsqueda UDP.' })
    } finally {
      setScanning(false)
    }
  }

  async function chooseDiscoveredServer(server: DiscoveredServer) {
    setManualIp(`${server.ip}:${server.port}`)
    setPairingCode('')
    setDeviceAccess(null)
    setManualStatus({ type: 'connecting', text: 'Verificando el servidor descubierto…' })
    try {
      await setManualServerUrl(server.serverUrl, server.certPem)
      const info = await getNetworkConnectionStatus()
      setNetworkStatus(info)
      const access = await requestClientDeviceAccess('')
      setDeviceAccess(access)
      setManualStatus({ type: 'ok', text: `${info.serverName}: ${access.message}` })
    } catch (e) {
      setManualStatus({
        type: 'err',
        text: typeof e === 'string' ? e : e instanceof Error ? e.message : 'No se pudo verificar el servidor descubierto.',
      })
    }
  }

  async function handleRequestDeviceAccess() {
    setManualStatus({ type: 'connecting', text: 'Enviando solicitud de conexión segura…' })
    try {
      const access = await requestClientDeviceAccess(pairingCode.trim())
      setDeviceAccess(access)
      setManualStatus({ type: access.status === 'approved' ? 'ok' : 'err', text: `${access.serverName}: ${access.message}` })
      if (access.status === 'approved') setPairingCode('')
    } catch (e) {
      setManualStatus({
        type: 'err',
        text: typeof e === 'string' ? e : e instanceof Error ? e.message : 'No se pudo solicitar acceso al servidor.',
      })
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const u = username.trim()
    const p = password.trim()
    if (isTauri() && (!profileReady || !userOptions.includes(u))) {
      setError(profileError ?? 'El perfil de esta instalación no está disponible.')
      return
    }
    if (!u || !p) {
      setError('Ingresá usuario y contraseña.')
      return
    }
    setBusy(true)
    try {
      if (isClient) {
        const status = await getNetworkConnectionStatus()
        setNetworkStatus(status)
        if (!status.isOnline) {
          setError(status.message || 'El servidor no está disponible. Configurá la conexión antes de iniciar sesión.')
          return
        }
        if (deviceAccess?.status !== 'approved') {
          setError(deviceAccess?.message ?? 'Solicitá autorización al servidor antes de iniciar sesión.')
          return
        }
      }
      const result = await onSuccess(u, p)
      if (!result.ok) {
        setError(
          result.reason === 'rate_limited'
            ? formatLoginRateLimitMessage(result.retryAfterMs)
            : 'Usuario o contraseña incorrectos.',
        )
      }
    } catch (err) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : 'No se pudo iniciar la sesión.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    void exitApp()
  }

  function handleUserKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIndex = (index + 1) % userOptions.length
      const nextUser = userOptions[nextIndex]
      if (nextUser) {
        setUsername(nextUser)
        userButtonRefs.current[nextIndex]?.focus()
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIndex = (index - 1 + userOptions.length) % userOptions.length
      const prevUser = userOptions[prevIndex]
      if (prevUser) {
        setUsername(prevUser)
        userButtonRefs.current[prevIndex]?.focus()
      }
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card" role="dialog" aria-label="Iniciar sesión">
        {/* Columna izquierda: marca, usuarios y versión */}
        <div className="login-left-col">
          <div className="login-brand">
            <img
              src={logoUrl}
              alt="Logo Cuidar"
              className="login-brand__logo"
              draggable={false}
            />
            <div className="login-brand__text">
              <span className="login-brand__title">CUIDAR</span>
              <span className="login-brand__subtitle">Centro Médico</span>
            </div>
          </div>

          <div
            className="login-user-list"
            role="radiogroup"
            aria-label="Seleccionar usuario"
          >
            {userOptions.map((u, index) => {
              const isSelected = username === u
              return (
                <button
                  key={u}
                  ref={(el) => {
                    userButtonRefs.current[index] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={`login-user-btn ${isSelected ? 'login-user-btn--selected' : ''}`}
                  style={{ animationDelay: `${0.25 + index * 0.1}s` }}
                  onClick={() => setUsername(u)}
                  onKeyDown={(e) => handleUserKeyDown(e, index)}
                  disabled={busy}
                >
                  <span className="login-user-btn__name">{u}</span>
                  <span className="login-user-btn__dot" aria-hidden="true" />
                </button>
              )
            })}
            {!profileReady && <p role="status">Verificando el perfil de esta instalación…</p>}
            {profileReady && userOptions.length === 0 && profileError && (
              <p role="alert">{profileError}</p>
            )}
          </div>

          <p className="login-version">
            Versión instalada: <strong>v{APP_VERSION}</strong>
          </p>

          {isClient && (
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setShowNetModal(true)}
                className="login-network-overlay"
                style={{
                  background: '#F0FDFA',
                  border: '1px solid #CCFBF1',
                  borderRadius: '8px',
                  color: '#0F766E',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                }}
              >
                <span>📶</span>
                <span>Configurar conexión</span>
              </button>
            </div>
          )}
        </div>

        {/* Columna derecha: formulario de contraseña y botones de acción */}
        <div className="login-right-col">
          {profileReady && userOptions.length > 0 ? (
            <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
              <h1 className="login-title">
                Ingrese la contraseña para{' '}
                <span key={username} className="login-title__username">
                  {username}
                </span>
              </h1>

              <div className="login-password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="login-password-input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña"
                  aria-label="Contraseña"
                  autoFocus
                  disabled={busy}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>

              {error && (
                <div>
                  <p className="login-error" role="alert" style={{ marginBottom: '8px' }}>
                    {error}
                  </p>
                </div>
              )}

              <div className="login-buttons-row">
                <button
                  type="submit"
                  className="login-btn login-btn--submit"
                  disabled={busy}
                >
                  {busy ? 'Ingresando…' : 'Ingresar'}
                </button>
                <button
                  type="button"
                  className="login-btn login-btn--cancel"
                  onClick={handleClose}
                  disabled={busy}
                >
                  Cerrar
                </button>
              </div>
            </form>
          ) : (
            <div className="login-form" role="status">
              <h1 className="login-title">Acceso restringido</h1>
              <p>
                {!profileReady
                  ? 'Verificando el perfil de esta instalación…'
                  : profileError ?? 'No hay cuentas habilitadas para este perfil.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {showNetModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setShowNetModal(false)}
        >
          <div
            className="login-network-dialog"
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '560px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1E293B', marginBottom: '8px' }}>
              Configurar conexión
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#64748B', marginBottom: '16px' }}>
              Esta configuración solo verifica y selecciona el servidor; no inicia sesión ni concede acceso a datos.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              <div className="network-dialog__rows">
                <strong>Estado: {networkStatus?.isOnline ? 'Conectado' : 'Sin conexión verificada'}</strong>
                <span>{networkStatus?.serverUrl ?? 'No hay servidor guardado'}</span>
                <span>{networkStatus?.message ?? 'Comprobá o configurá la dirección del servidor.'}</span>
                {deviceAccess && (
                  <span>{deviceAccess.serverName}: {deviceAccess.message}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleDiscover()}
                disabled={scanning}
                style={{
                  textAlign: 'left',
                  background: '#EFF6FF',
                  border: '1.5px solid #2563EB',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  cursor: 'pointer',
                }}
              >
                {scanning ? 'Buscando…' : 'Buscar servidor LAN por UDP 8788'}
              </button>
              {discoveredServers.map((server) => (
                <div key={server.serverUrl} className="network-server-choice-item">
                  <div>
                    <strong>{server.serverName}</strong> — {server.ip}:{server.port}
                  </div>
                  <button type="button" onClick={() => void chooseDiscoveredServer(server)}>
                    Conectar
                  </button>
                </div>
              ))}

              <div
                className="modal-ip-card"
                style={{
                  textAlign: 'left',
                  background: '#FFF7E6',
                  border: '1.5px solid #F0A500',
                  borderRadius: '10px',
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontWeight: 800, color: '#C2410C', fontSize: '0.92rem' }}>
                  🔧 IP y puerto HTTPS
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px' }}>
                  La identidad HTTPS del servidor se verifica automáticamente. Ingresá la clave que aparece en el estado del servidor para autorizar este dispositivo; la autorización se conserva hasta que el servidor la revoque.
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    className="modal-ip-input"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="192.168.1.100:8787"
                    style={{
                      flex: 1,
                      border: '1px solid #CBD5E1',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      fontFamily: 'Consolas, monospace',
                      fontSize: '0.8rem',
                      background: '#fff',
                    }}
                  />
                  <button
                    type="button"
                    className="modal-ip-btn"
                    onClick={() => void handleManualConnect()}
                    disabled={busy || manualStatus?.type === 'connecting' || !manualIp.trim()}
                    style={{
                      background: '#F0A500',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {manualStatus?.type === 'connecting' ? 'Conectando…' : 'Conectar'}
                  </button>
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label htmlFor="client-pairing-code" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    Clave de conexión del servidor
                  </label>
                  <input
                    id="client-pairing-code"
                    type="text"
                    value={pairingCode}
                    onChange={(e) => setPairingCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    placeholder="6 caracteres"
                    maxLength={6}
                    autoComplete="one-time-code"
                    style={{
                      border: '1px solid #CBD5E1',
                      borderRadius: '6px',
                      padding: '8px',
                      fontFamily: 'Consolas, monospace',
                      fontSize: '1rem',
                      letterSpacing: '0.2em',
                    }}
                  />
                  <button
                    type="button"
                    className="modal-ip-btn"
                    onClick={() => void handleRequestDeviceAccess()}
                    disabled={!networkStatus?.isOnline || manualStatus?.type === 'connecting'}
                    style={{
                      background: '#0F766E',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {deviceAccess?.status === 'approved' ? 'Actualizar estado de autorización' : 'Solicitar autorización'}
                  </button>
                </div>
                {manualStatus && (
                  <div
                    className={`modal-ip-status modal-ip-status--${manualStatus.type}`}
                    style={{ fontSize: '0.75rem', marginTop: '8px' }}
                  >
                    {manualStatus.text}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowNetModal(false)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                background: '#E2E8F0',
                border: 'none',
                color: '#334155',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}