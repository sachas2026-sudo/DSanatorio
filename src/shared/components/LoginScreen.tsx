import { useState, useRef, type FormEvent } from 'react'
import {
  getDefaultLoginUsername,
  getLoginUserOptions,
  formatLoginRateLimitMessage,
  type LoginAttemptResult,
} from '../../lib/auth'
import { exitApp } from '../../lib/exitApp'
import { APP_VERSION } from '../../lib/appVersion'
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
  const userOptions = getLoginUserOptions()
  const userButtonRefs = useRef<(HTMLButtonElement | null)[]>([])

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
              <p className="login-error" role="alert">
                {error}
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
    </div>
  )
}
