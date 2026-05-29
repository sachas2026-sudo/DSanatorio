import { useState, type FormEvent } from 'react'
import {
  getDefaultLoginUsername,
  getLoginUserOptions,
} from '../lib/auth'
import { exitApp } from '../lib/exitApp'
import { APP_DISPLAY_NAME } from '../lib/pdfBranding'
import './login-screen.css'

type Props = {
  onSuccess: (username: string, password: string) => Promise<boolean>
}

export function LoginScreen({ onSuccess }: Props) {
  const [username, setUsername] = useState(getDefaultLoginUsername())
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const userOptions = getLoginUserOptions()

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
      const ok = await onSuccess(u, p)
      if (!ok) {
        setError('Usuario o contraseña incorrectos.')
      }
    } catch {
      setError('No se pudo iniciar la sesión.')
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    void exitApp()
  }

  return (
    <div className="login-screen">
      <div className="login-card" role="dialog" aria-labelledby="login-title">
        <div className="login-card__brand">
          <span className="login-card__logo" aria-hidden>
            +
          </span>
          <div>
            <h1 id="login-title">{APP_DISPLAY_NAME}</h1>
            <p className="login-card__sub">Gestión clínica</p>
          </div>
        </div>

        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="login-field">
            <span>Usuario</span>
            <select
              className="login-field__select"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={busy}
            >
              {userOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="login-field">
            <span>Contraseña</span>
            <div className="login-field__password">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                autoFocus
                disabled={busy}
              />
              <button
                type="button"
                className="login-field__toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </label>
          {error && (
            <p className="login-form__error" role="alert">
              {error}
            </p>
          )}
          <div className="login-form__actions">
            <button
              type="submit"
              className="btn btn-primary login-form__action"
              disabled={busy}
            >
              {busy ? 'Ingresando…' : 'Ingresar'}
            </button>
            <button
              type="button"
              className="btn btn-primary login-form__action"
              onClick={handleClose}
              disabled={busy}
            >
              Cerrar
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
