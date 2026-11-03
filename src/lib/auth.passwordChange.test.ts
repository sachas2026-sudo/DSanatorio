import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  ensureAuthAccountsLoaded,
  authenticate,
  changeAccountPassword,
  verifyCurrentPassword,
  getEffectiveAccounts,
  resetAuthAccountsCacheForTests,
  readStoredSession,
  storeSession,
  saveStoredAccounts,
} from './auth'

const createMockStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
}

describe('cambio obligatorio de contraseña', () => {
  const local = createMockStorage()
  const session = createMockStorage()

  beforeEach(async () => {
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', session)
    local.clear()
    session.clear()
    resetAuthAccountsCacheForTests()
    await ensureAuthAccountsLoaded()
  })

  it('las cuentas por defecto NO fuerzan cambio de contraseña para permitir ingreso directo', () => {
    const accounts = getEffectiveAccounts()
    for (const a of accounts) {
      expect(a.mustChangePassword).toBe(false)
    }
  })

  it('authenticate devuelve mustChangePassword false para cuenta por defecto', async () => {
    const res = await authenticate('Admi', 'Admi')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.session.mustChangePassword).toBe(false)
    }
  })

  it('changeAccountPassword limpia el flag si estaba activo y verifica la nueva contraseña', async () => {
    const accounts = getEffectiveAccounts()
    saveStoredAccounts(accounts.map((a) => a.username === 'Admi' ? { ...a, mustChangePassword: true } : a))
    const res = await authenticate('Admi', 'Admi')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.session.mustChangePassword).toBe(true)
    }

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
