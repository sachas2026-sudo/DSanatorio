import { describe, expect, it, beforeEach } from 'vitest'
import {
  ensureAuthAccountsLoaded,
  authenticate,
  formatLoginRateLimitMessage,
  getEffectiveAccounts,
  getLoginUserOptions,
  getLoginUserOptionsForInstallProfile,
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

  it('acepta las credenciales iniciales acordadas', async () => {
    const credentials = [
      ['Aguirre Mary', '789', 'secretaria'],
      ['Barua Andrea', '951', 'secretaria'],
      ['Contratantes', '465', 'afiliado'],
      ['Admi', '753', 'admin'],
    ] as const

    for (const [username, password, role] of credentials) {
      const result = await authenticate(username, password)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.session.role).toBe(role)
    }
  })

  it('rechaza los usuarios y las contraseñas anteriores', async () => {
    const obsoleteCredentials = [
      ['Afiliados', '465'],
      ['Contratantes', '456'],
      ['Aguirre Mary', '123'],
      ['Barua Andrea', '1379'],
      ['Admi', 'admin'],
    ] as const

    for (const [username, password] of obsoleteCredentials) {
      expect((await authenticate(username, password)).ok).toBe(false)
    }
  })

  it('limita los usuarios de ingreso al rol del perfil instalado', () => {
    expect(getLoginUserOptions('secretaria')).toEqual([
      'Aguirre Mary',
      'Barua Andrea',
    ])
    expect(getLoginUserOptions('afiliado')).toEqual(['Contratantes'])
    expect(getLoginUserOptions('admin')).toEqual(['Admi'])
  })

  it('no expone cuentas si el perfil instalado falta o no es válido', () => {
    expect(getLoginUserOptionsForInstallProfile(null)).toEqual([])
    expect(getLoginUserOptionsForInstallProfile('desconocido')).toEqual([])
  })

  it('limita las cuentas visibles al perfil exacto de instalación', () => {
    expect(getLoginUserOptionsForInstallProfile('server')).toEqual([
      'Aguirre Mary',
      'Barua Andrea',
    ])
    expect(getLoginUserOptionsForInstallProfile('contratantes')).toEqual(['Contratantes'])
    expect(getLoginUserOptionsForInstallProfile('administracion')).toEqual(['Admi'])
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


