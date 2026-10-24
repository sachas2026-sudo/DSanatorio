import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DNI_PAC_LABEL,
  parsePatientPickerQuery,
  patientMatchesPickerQuery,
  patientPickerLine,
  patientPickerLineLegacy,
  isDniPacCorto,
  ultimoDniPacCorto,
} from './dniLabels'

const paciente = {
  dni: '232323232',
  apellido: 'Piray',
  nombre: 'Luis',
}

describe('isDniPacCorto', () => {
  it('acepta 1 a 3 dígitos', () => {
    expect(isDniPacCorto('1')).toBe(true)
    expect(isDniPacCorto('456')).toBe(true)
    expect(isDniPacCorto('062')).toBe(true)
  })

  it('rechaza DNIs largos o no numéricos', () => {
    expect(isDniPacCorto('2356598')).toBe(false)
    expect(isDniPacCorto('1234')).toBe(false)
    expect(isDniPacCorto('abc')).toBe(false)
  })
})

describe('ultimoDniPacCorto', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key]
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
    })
  })

  it('devuelve null sin DNIs cortos', () => {
    expect(ultimoDniPacCorto([])).toBeNull()
    expect(ultimoDniPacCorto([{ dni: '2356598' }])).toBeNull()
    expect(ultimoDniPacCorto([{ dni: 'abc' }])).toBeNull()
  })

  it('muestra solo DNIs de 1 a 3 dígitos (el más alto en la base)', () => {
    expect(ultimoDniPacCorto([{ dni: '1' }])).toBe('1')
    expect(ultimoDniPacCorto([{ dni: '62' }, { dni: '456' }])).toBe('456')
    expect(
      ultimoDniPacCorto([{ dni: '62' }, { dni: '2356598' }]),
    ).toBe('62')
  })
})

describe('patientPickerLine', () => {
  it('formato nuevo con etiqueta DNI Pac', () => {
    expect(patientPickerLine(paciente.dni, paciente.apellido, paciente.nombre)).toBe(
      `${DNI_PAC_LABEL} 232323232 · Piray, Luis`,
    )
  })

  it('formato legacy sin etiqueta', () => {
    expect(
      patientPickerLineLegacy(paciente.dni, paciente.apellido, paciente.nombre),
    ).toBe('232323232 · Piray, Luis')
  })
})

describe('patientMatchesPickerQuery', () => {
  it('acepta formato legacy al confirmar turno', () => {
    expect(
      patientMatchesPickerQuery(
        paciente,
        '232323232 · Piray, Luis',
      ),
    ).toBe(true)
  })

  it('acepta formato nuevo', () => {
    expect(
      patientMatchesPickerQuery(
        paciente,
        `${DNI_PAC_LABEL} 232323232 · Piray, Luis`,
      ),
    ).toBe(true)
  })

  it('acepta solo DNI Pac', () => {
    expect(patientMatchesPickerQuery(paciente, '232323232')).toBe(true)
  })

  it('busca por DNI parcial mientras se escribe', () => {
    expect(patientMatchesPickerQuery(paciente, '232')).toBe(true)
    expect(patientMatchesPickerQuery(paciente, '232323')).toBe(true)
    expect(patientMatchesPickerQuery(paciente, '999')).toBe(false)
  })

  it('parsea consulta legacy', () => {
    expect(parsePatientPickerQuery('232323232 · Piray, Luis')).toEqual({
      dni: '232323232',
      apellidoNombre: 'Piray, Luis',
    })
  })
})
