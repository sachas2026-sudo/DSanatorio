import { describe, expect, it, beforeEach } from 'vitest'
import {
  ensureAuthAccountsLoaded,
  authenticate,
  changeAccountPassword,
  verifyCurrentPassword,
  getEffectiveAccounts,
  resetAuthAccountsCacheForTests,
  readStoredSession,
  storeSession,
} from './auth'

describe('cambio obligatorio de contraseña', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    localStorage.clear()
    resetAuthAccountsCacheForTests()
    await ensureAuthAccountsLoaded()
  })

  it('las cuentas por defecto requieren cambio de contraseña', () => {
    const accounts = getEffectiveAccounts()
    for (const a of accounts) {
      expect(a.mustChangePassword).toBe(true)
    }
  })

  it('authenticate devuelve mustChangePassword true para cuenta por defecto', async () => {
    const res = await authenticate('Admi', 'Admi')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.session.mustChangePassword).toBe(true)
    }
  })

  it('changeAccountPassword limpia el flag y permite verificar la nueva contraseña', async () => {
    await authenticate('Admi', 'Admi')
    await changeAccountPassword('Admi', 'NuevaClave123')
    const account = getEffectiveAccounts().find((a) => a.username === 'Admi')
    expect(account?.mustChangePassword).toBe(false)
    expect(await verifyCurrentPassword('Admi', 'NuevaClave123')).toBe(true)
    expect(await verifyCurrentPassword('Admi', 'Admi')).toBe(false)
  })

  it('la sesión almacenada refleja mustChangePassword false tras el cambio', async () => {
    const res = await authenticate('Admi', 'Admi')
    if (res.ok) storeSession(res.session)
    await changeAccountPassword('Admi', 'OtraClave456')
    const session = readStoredSession()
    expect(session?.mustChangePassword).toBe(false)
  })
})
