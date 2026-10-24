import { describe, expect, it } from 'vitest'
import {
  formatPorcentajeInput,
  parsePorcentajeInput,
  parsePorcentajeStored,
  sanitizePorcentajeInput,
} from './porcentajeInput'

describe('porcentajeInput', () => {
  it('acepta decimales con coma', () => {
    expect(parsePorcentajeInput('10,28')).toBe(10.28)
    expect(formatPorcentajeInput(10.28)).toBe('10,28')
  })

  it('acepta decimales con punto al guardar', () => {
    expect(parsePorcentajeStored('15.5')).toBe(15.5)
    expect(parsePorcentajeStored(10.286)).toBe(10.29)
  })

  it('sanitiza entrada del formulario', () => {
    expect(sanitizePorcentajeInput('10,28')).toBe('10,28')
    expect(sanitizePorcentajeInput('10.28')).toBe('10,28')
    expect(sanitizePorcentajeInput('1000,99')).toBe('100,99')
  })

  it('rechaza porcentaje fuera de rango', () => {
    expect(parsePorcentajeStored(1000)).toBeUndefined()
    expect(parsePorcentajeInput('abc')).toBeUndefined()
  })
})
