import { describe, expect, it } from 'vitest'
import {
  formatAppError,
  formatPersistError,
} from './persistAlert'

describe('persistAlert', () => {
  it('formatPersistError incluye contexto y detalle', () => {
    expect(formatPersistError(new Error('disco lleno'), 'No se guardó')).toBe(
      'No se guardó: disco lleno',
    )
    expect(formatPersistError(null, 'Falló')).toBe('Falló.')
  })

  it('formatAppError usa fallback si no hay detalle', () => {
    expect(formatAppError(new Error('timeout'), 'Operación fallida')).toBe(
      'timeout',
    )
    expect(formatAppError(null, 'Operación fallida')).toBe('Operación fallida')
  })
})
