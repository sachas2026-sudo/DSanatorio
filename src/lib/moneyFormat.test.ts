import { describe, it, expect } from 'vitest'
import {
  parseMoneyInput,
  formatMoneyDisplay,
  sanitizeMoneyTyping,
  MONTO_MAXIMO_MEDICO,
} from './moneyFormat'

describe('moneyFormat', () => {
  it('formatea montos enteros a formato es-AR con prefijo $ ($ 10.000 <-> 10000)', () => {
    expect(formatMoneyDisplay(10000)).toBe('$ 10.000')
    expect(formatMoneyDisplay(25000)).toBe('$ 25.000')
    expect(formatMoneyDisplay(0)).toBe('$ 0')
    expect(formatMoneyDisplay(1500000)).toBe('$ 1.500.000')
  })

  it('parsea strings con formato $ a enteros limpios', () => {
    expect(parseMoneyInput('$ 10.000')).toBe(10000)
    expect(parseMoneyInput('$ 25.000')).toBe(25000)
    expect(parseMoneyInput('10000')).toBe(10000)
    expect(parseMoneyInput('$ 0')).toBe(0)
    expect(parseMoneyInput('')).toBe(0)
    expect(parseMoneyInput(null)).toBe(0)
    expect(parseMoneyInput(undefined)).toBe(0)
  })

  it('ignora letras, signos negativos y caracteres especiales', () => {
    expect(parseMoneyInput('-10000')).toBe(10000) // solo extrae dígitos y no permite negativo
    expect(parseMoneyInput('abc $ 15.000 xyz')).toBe(15000)
  })

  it('respeta el tope maximo para evitar desbordes', () => {
    expect(parseMoneyInput(200_000_000)).toBe(MONTO_MAXIMO_MEDICO)
    expect(parseMoneyInput('$ 999.999.999')).toBe(MONTO_MAXIMO_MEDICO)
  })

  it('sanitizeMoneyTyping formatea en vivo y permite vaciar el input', () => {
    expect(sanitizeMoneyTyping('')).toBe('')
    expect(sanitizeMoneyTyping('1')).toBe('$ 1')
    expect(sanitizeMoneyTyping('10000')).toBe('$ 10.000')
    expect(sanitizeMoneyTyping('$ 25000')).toBe('$ 25.000')
  })
})

