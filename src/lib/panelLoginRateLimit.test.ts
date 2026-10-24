import { describe, expect, it } from 'vitest'
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from './panelLoginRateLimit'

describe('panelLoginRateLimit', () => {
  it('bloquea tras varios intentos fallidos', () => {
    const key = `test-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(key)).toEqual({ ok: true })
      recordLoginFailure(key)
    }
    const blocked = checkLoginRateLimit(key)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0)
    }
  })

  it('restablece el contador tras login exitoso', () => {
    const key = `ok-${Date.now()}`
    recordLoginFailure(key)
    recordLoginFailure(key)
    recordLoginSuccess(key)
    expect(checkLoginRateLimit(key)).toEqual({ ok: true })
  })
})
