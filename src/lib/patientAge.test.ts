import { describe, expect, it } from 'vitest'
import {
  edadDesdeFechaNacimiento,
  edadDesdeFechaNacimientoLabel,
} from './patientAge'

describe('edadDesdeFechaNacimiento', () => {
  it('calcula años cumplidos entre F. nacimiento y hoy', () => {
    expect(
      edadDesdeFechaNacimiento('2000-06-15', new Date('2026-06-02T15:00:00')),
    ).toBe(25)
    expect(
      edadDesdeFechaNacimiento('2000-06-15', new Date('2026-06-15T08:00:00')),
    ).toBe(26)
  })

  it('no suma un año el día anterior al cumpleaños', () => {
    expect(
      edadDesdeFechaNacimiento('2000-06-15', new Date('2026-06-14T23:59:00')),
    ).toBe(25)
  })

  it('devuelve null sin fecha, inválida o futura', () => {
    expect(edadDesdeFechaNacimiento('')).toBeNull()
    expect(edadDesdeFechaNacimiento('no-es-fecha')).toBeNull()
    expect(
      edadDesdeFechaNacimiento('2030-01-01', new Date('2026-06-02T12:00:00')),
    ).toBeNull()
  })
})

describe('edadDesdeFechaNacimientoLabel', () => {
  it('formatea la edad para la pastilla', () => {
    expect(
      edadDesdeFechaNacimientoLabel(
        '1990-03-20',
        new Date('2026-03-20T12:00:00'),
      ),
    ).toBe('36')
    expect(edadDesdeFechaNacimientoLabel('')).toBe('')
  })
})
