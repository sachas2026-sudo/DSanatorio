import { useState, useRef, useEffect, type FormEvent } from 'react'
import {
  getDefaultLoginUsername,
  getLoginUserOptions,
  formatLoginRateLimitMessage,
  type LoginAttemptResult,
  isClientMode,
} from '../../lib/auth'
import { exitApp } from '../../lib/exitApp'
import { APP_VERSION } from '../../lib/appVersion'
import { autoConnectServer, setModeLocal } from '../../lib/appMode'
import {
  getNetworkConnectionStatus,
  setManualServerUrl,
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
  const [netMessage, setNetMessage] = useState<string | null>(null)
  const [showNetModal, setShowNetModal] = useState(false)
  const userOptions = getLoginUserOptions()
  const userButtonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [manualIp, setManualIp] = useState('')
  const [manualStatus, setManualStatus] = useState<{ type: 'ok' | 'err' | 'connecting'; text: string } | null>(null)

  useEffect(() => {
    // Precargamos la última IP manual guardada en localStorage.
    try {
      const stored = window.localStorage.getItem('sanatorio.manualIp') ?? ''
      if (stored.trim()) setManualIp(stored.trim())
    } catch {
      // localStorage no disponible o bloqueado; ignoramos.
    }
  }, [])

  useEffect(() => {
    // Determinamos si la PC actual es modo cliente (mostrar "Usar Servidor Local" solo en servidor)
    isClientMode().then((client) => {
      setIsClientMode(client)
    }).catch(() => {
      setIsClientMode(false) // Si falla, asumimos modo servidor para mostrar la opción
    })
  }, [])

  async function handleManualConnect() {
    const raw = manualIp.trim()
    if (!raw) {
      setManualStatus({ type: 'err', text: 'Ingresá la dirección IP del servidor.' })
      return
    }
    const ipM = raw.match(
      /^((?:https?:\/\/)?)((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?::([0-9]{1,5}))?$/)
    if (!ipM) {
      setManualStatus({ type: 'err', text: 'Formato inválido: IPv4 con opcional puerto.' })
      return
    }
    const scheme = ipM[1] || 'https://'
    const target = `${scheme}${ipM[2]}:${ipM[3] ?? '8787'}`
    setManualStatus({ type: 'connecting', text: 'Conectando...' })
    try {
      await setManualServerUrl(target)
      const info = await getNetworkConnectionStatus()
      if (info.isOnline) {
        // Guardamos la IP que respondió para precargarla luego.
        try {
          window.localStorage.setItem('sanatorio.manualIp', manualIp.trim())
        } catch {
          // localStorage no disponible; ignoramos.
        }
        setManualStatus({ type: 'ok', text: `Conectado en ${info.serverUrl ?? target}` })
      } else {
        setManualStatus({ type: 'err', text: `No respondió el servidor (${target})` })
      }
    } catch (e) {
      setManualStatus({ type: 'err', text: typeof e === 'string' ? e : 'No se pudo conectar.' })
    }
  }

  async function handleAutoConnect() {
    setScanning(true)
    setError(null)
    setNetMessage('Buscando servidor en la red (Cable o Wi-Fi)...')
    try {
      const srv = await autoConnectServer()
      setNetMessage(`¡Servidor conectado en ${srv.serverUrl}! Podés ingresar ahora.`)
    } catch (e) {
      setNetMessage(typeof e === 'string' ? e : 'No se encontró servidor en la red.')
    } finally {
      setScanning(false)
    }
  }

  async function handleSetLocal() {
    setScanning(true)
    setError(null)
    setNetMessage('Cambiando a modo Servidor Local...')
    try {
      await setModeLocal()
      setIsClientMode(false)
      setError(null)
      setNetMessage('Esta PC quedó configurada como Servidor Local. Ingresá con tu contraseña.')
    } catch (e) {
      setNetMessage(typeof e === 'string' ? e : 'Error al cambiar modo.')
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const u = username.trim()
    const p = password.trim()
    if (!u || !p) {
      setError('Ingresá usuario y contraseña.')
      return
    }
    setBusy(true)
    try {
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
          </div>

          <p className="login-version">
            Versión instalada: <strong>v{APP_VERSION}</strong>
          </p>

          <div style={{ marginTop: '10px' }}>
            <button
              type="button"
              onClick={() => setShowNetModal(true)}
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
              <span>Reconectar / Red WiFi</span>
            </button>
          </div>
        </div>

        {/* Columna derecha: formulario de contraseña y botones de acción */}
        <div className="login-right-col">
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
                {(error.toLowerCase().includes('servidor') ||
                  error.toLowerCase().includes('request') ||
                  error.toLowerCase().includes('url') ||
                  error.toLowerCase().includes('conex')) && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => void handleSetLocal()}
                      disabled={scanning}
                      style={{
                        background: '#0D766E',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      💻 Usar Servidor Local (Esta PC)
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAutoConnect()}
                      disabled={scanning}
                      style={{
                        background: '#2563EB',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {scanning ? 'Buscando…' : '📡 Buscar Servidor en la red (Cable o Wi-Fi)'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {netMessage && (
              <p
                style={{
                  fontSize: '0.82rem',
                  color: '#0F766E',
                  fontWeight: 700,
                  background: '#F0FDFA',
                  border: '1px solid #CCFBF1',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  marginBottom: '10px',
                }}
              >
                {netMessage}
              </p>
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
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1E293B', marginBottom: '8px' }}>
              Ajustes de Conexión de Red
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#64748B', marginBottom: '16px' }}>
              Elegí cómo debe conectarse este programa para evitar problemas de conexión:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              <button
                type="button"
                onClick={() => {
                  void handleSetLocal()
                  setShowNetModal(false)
                }}
                disabled={scanning}
                style={{
                  textAlign: 'left',
                  background: '#F0FDFA',
                  border: '1.5px solid #0D766E',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 800, color: '#0F766E', fontSize: '0.92rem' }}>
                  💻 Modo Servidor Local (Esta PC)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px' }}>
                  Usar la base de datos de esta máquina directamente (ideal para la PC principal de Mesa de Entrada).
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleAutoConnect()
                  setShowNetModal(false)
                }}
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
                <div style={{ fontWeight: 800, color: '#1E40AF', fontSize: '0.92rem' }}>
                  📡 Buscar Servidor en la red (Cable o Wi-Fi)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px' }}>
                  Buscar automáticamente la PC Servidor encendida en la red local y reconectar.
                </div>
              </button>

              {/* Tercera tarjeta: Conectar por IP manual */}
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
                  🔧 Conectar por IP manual
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px' }}>
                  Ingresar la dirección IP del servidor directamente (útil si la búsqueda automática no funciona).
                </div>
                <div
                  style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    className="modal-ip-input"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="192.168.68.104:8787"
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
