import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { changeAccountPassword, verifyCurrentPassword } from '../lib/auth'

export function ForcePasswordChange() {
  const { session } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (next === session?.username) {
      setError('La contraseña no puede ser igual al nombre de usuario.')
      return
    }
    if (next !== confirm) {
      setError('La confirmación no coincide.')
      return
    }
    if (!session) return
    setBusy(true)
    try {
      const ok = await verifyCurrentPassword(session.username, current)
      if (!ok) {
        setError('La contraseña actual no es correcta.')
        return
      }
      if (current === next) {
        setError('La nueva contraseña no puede ser igual a la anterior.')
        return
      }
      await changeAccountPassword(session.username, next)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', zIndex: 9999 }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 24, borderRadius: 8, width: 360, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
        <h2 style={{ marginTop: 0 }}>Cambio obligatorio de contraseña</h2>
        <p style={{ fontSize: 14, color: '#555' }}>
          Por seguridad, debés cambiar tu contraseña antes de continuar.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Contraseña actual</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ width: '100%' }} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Nueva contraseña</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: '100%' }} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Confirmar contraseña</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: '100%' }} required />
        </div>
        {error && <div style={{ color: '#c00', marginBottom: 12, fontSize: 14 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Guardando...' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  )
}
