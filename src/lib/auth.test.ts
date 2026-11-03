import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  ensureAuthAccountsLoaded,
  authenticate,
  formatLoginRateLimitMessage,
  getEffectiveAccounts,
  resetAuthAccountsCacheForTests,
  revalidateStoredSession,
  storeSession,
} from './auth'
import {
  checkLoginRateLimit,
  recordLoginFailure,
} from './loginRateLimit'

describe('revalidateStoredSession', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    localStorage.clear()
    resetAuthAccountsCacheForTests()
    await ensureAuthAccountsLoaded()
  })

  it('descarta sesión si el usuario ya no existe', () => {
    storeSession({
      username: 'UsuarioBorrado',
      role: 'admin',
      displayName: 'X',
    })
    expect(revalidateStoredSession()).toBeNull()
    expect(sessionStorage.getItem('sanatorio-auth-session')).toBeNull()
  })

  it('descarta sesión si cambió el rol', () => {
    storeSession({
      username: 'Secretaria',
      role: 'admin',
      displayName: 'Secretaría',
    })
    expect(revalidateStoredSession()).toBeNull()
  })

  it('conserva sesión válida con datos actualizados', () => {
    storeSession({
      username: 'Admi',
      role: 'admin',
      displayName: 'Viejo',
    })
    const session = revalidateStoredSession()
    expect(session?.username).toBe('Admi')
    expect(session?.role).toBe('admin')
    expect(session?.displayName).toBe(
      getEffectiveAccounts().find((a) => a.username === 'Admi')?.displayName,
    )
  })
})

describe('authenticate rate limit', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    localStorage.clear()
    resetAuthAccountsCacheForTests()
    await ensureAuthAccountsLoaded()
  })

  it('bloquea tras varios intentos fallidos', async () => {
    const key = `desktop:admi`
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(key)
    }
    expect(checkLoginRateLimit(key).ok).toBe(false)

    const result = await authenticate('Admi', 'mal')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited')
      expect(formatLoginRateLimitMessage(result.retryAfterMs)).toMatch(
        /Demasiados intentos/,
      )
    }
  })
})

describe('getUserDisplayNameForShift', () => {
  it('retorna el nombre real del usuario según el turno seleccionado', async () => {
    const { getUserDisplayNameForShift } = await import('./auth')
    expect(getUserDisplayNameForShift('manana', 'Secretaria 1')).toBe('Aguirre Mary')
    expect(getUserDisplayNameForShift('tarde', 'Secretaria 1')).toBe('Barua Andrea')
    expect(getUserDisplayNameForShift('todos', 'Secretaria 1')).toBe('')
  })
})

describe('resolveUserRealName', () => {
  it('resuelve Aguirre, Aguirre Mary y Secretaria 2 como Aguirre Mary', async () => {
    const { resolveUserRealName } = await import('./auth')
    expect(resolveUserRealName('Aguirre')).toBe('Aguirre Mary')
    expect(resolveUserRealName('Aguirre Mary')).toBe('Aguirre Mary')
    expect(resolveUserRealName('Secretaria 2')).toBe('Aguirre Mary')
    expect(resolveUserRealName('Secretaria 1')).toBe('Barua Andrea')
    expect(resolveUserRealName('Barua')).toBe('Barua Andrea')
    expect(resolveUserRealName('Admi')).toBe('Admi')
  })
})


