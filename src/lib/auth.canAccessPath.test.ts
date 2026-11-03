import { describe, expect, it } from 'vitest'
import { canAccessPath } from './auth'

describe('canAccessPath — matriz rol x ruta', () => {
  const adminOnly = ['/configuracion', '/backup', '/mantenimiento', '/pagos-cancelados', '/afiliados']
  const publicPaths = ['/', '/pacientes', '/medicos', '/agenda', '/pagos']

  it('admin accede a todas las rutas', () => {
    for (const p of [...adminOnly, ...publicPaths]) {
      expect(canAccessPath('admin', p)).toBe(true)
    }
  })

  it('secretaria accede a rutas públicas pero no a admin-only ni Afiliados', () => {
    for (const p of publicPaths) {
      expect(canAccessPath('secretaria', p)).toBe(true)
    }
    for (const p of adminOnly) {
      expect(canAccessPath('secretaria', p)).toBe(false)
    }
    expect(canAccessPath('secretaria', '/afiliados')).toBe(false)
  })

  it('afiliado solo accede a /afiliados y /pacientes', () => {
    expect(canAccessPath('afiliado', '/afiliados')).toBe(true)
    expect(canAccessPath('afiliado', '/pacientes')).toBe(true)
    for (const p of ['/', '/medicos', '/agenda', '/pagos', '/configuracion', '/backup', '/mantenimiento', '/pagos-cancelados']) {
      expect(canAccessPath('afiliado', p)).toBe(false)
    }
  })
})
