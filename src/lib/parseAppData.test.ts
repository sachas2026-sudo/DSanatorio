import { describe, expect, it } from 'vitest'
import {
  asNumber,
  asString,
  isRecord,
  nonEmptyId,
  normalizePagosCancelados,
  parseAppDataJson,
  parseAppDataRecord,
  parseDoctor,
  parsePatient,
  parsePayment,
} from './parseAppData'

describe('parseAppData helpers', () => {
  it('isRecord distingue objetos de arrays y null', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })

  it('nonEmptyId rechaza strings vacíos', () => {
    expect(nonEmptyId('  abc  ')).toBe('abc')
    expect(nonEmptyId('')).toBeNull()
    expect(nonEmptyId(1)).toBeNull()
  })

  it('asString y asNumber aplican fallback', () => {
    expect(asString(42)).toBe('42')
    expect(asString(undefined, 'x')).toBe('x')
    expect(asNumber('15', 0)).toBe(15)
    expect(asNumber('bad', 7)).toBe(7)
  })
})

describe('parsePatient', () => {
  it('requiere id no vacío', () => {
    expect(parsePatient({ id: 'p1', nombre: 'Ana' })).toMatchObject({
      id: 'p1',
      nombre: 'Ana',
    })
    expect(parsePatient({ id: '', nombre: 'Ana' })).toBeNull()
  })
})

describe('parseDoctor', () => {
  it('descarta porcentaje fuera de rango', () => {
    expect(parseDoctor({ id: 'd1', porcentaje: 1000 })?.porcentaje).toBeUndefined()
    expect(parseDoctor({ id: 'd1', porcentaje: 50 })?.porcentaje).toBe(50)
  })

  it('normaliza tipoAgenda', () => {
    expect(parseDoctor({ id: 'd1', tipoAgenda: 'mensual' })?.tipoAgenda).toBe(
      'mensual',
    )
    expect(parseDoctor({ id: 'd1', tipoAgenda: 'otro' })?.tipoAgenda).toBe(
      'semanal',
    )
  })
})

describe('parsePayment', () => {
  it('acepta citaId null y método por defecto', () => {
    expect(
      parsePayment({
        id: 'pay1',
        patientId: 'p1',
        doctorId: 'd1',
        fecha: '2026-01-01',
        citaId: null,
      }),
    ).toMatchObject({ citaId: null, metodo: 'Efectivo' })
  })
})

describe('normalizePagosCancelados', () => {
  it('migra eliminadoEn a canceladoEn', () => {
    const rows = normalizePagosCancelados([
      {
        id: 'pc1',
        motivo: 'cancelacion_paciente',
        eliminadoEn: '2026-01-02T10:00:00.000Z',
        payment: {
          id: 'pay1',
          patientId: 'p1',
          doctorId: 'd1',
          citaId: null,
          monto: 100,
          fecha: '2026-01-01',
          metodo: 'Efectivo',
          notas: '',
        },
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.canceladoEn).toBe('2026-01-02T10:00:00.000Z')
  })
})

describe('parseAppDataRecord', () => {
  const minimal = {
    patients: [{ id: 'p1', nombre: 'Ana', apellido: 'López' }],
    doctors: [{ id: 'd1', nombre: 'Dr', apellido: 'House' }],
  }

  it('normaliza estructura mínima con defaults', () => {
    const data = parseAppDataRecord(minimal)
    expect(data.patients).toHaveLength(1)
    expect(data.doctors).toHaveLength(1)
    expect(data.horarios).toEqual([])
    expect(data.payments).toEqual([])
    expect(data.pagosCancelados).toEqual([])
    expect(data.settings).toEqual({
      email: '',
      emailGerente: '',
      telefonoGerente: '',
      clave: '',
      telefono: '',
      cuit: '',
    })
  })

  it('filtra pacientes inválidos', () => {
    const data = parseAppDataRecord({
      ...minimal,
      patients: [{ id: 'p1', nombre: 'Ok' }, { nombre: 'Sin id' }],
    })
    expect(data.patients).toHaveLength(1)
    expect(data.patients[0]?.id).toBe('p1')
  })

  it('usa turnosEliminados si no hay pagosCancelados', () => {
    const data = parseAppDataRecord({
      ...minimal,
      turnosEliminados: [
        {
          id: 'pc1',
          motivo: 'otros',
          canceladoEn: '2026-02-01',
          payment: {
            id: 'pay1',
            patientId: 'p1',
            doctorId: 'd1',
            citaId: null,
            monto: 50,
            fecha: '2026-02-01',
            metodo: 'Tarjeta',
            notas: '',
          },
        },
      ],
    })
    expect(data.pagosCancelados).toHaveLength(1)
  })

  it('rechaza raíz no objeto', () => {
    expect(() => parseAppDataRecord(null)).toThrow(
      'Formato de base de datos no reconocido.',
    )
  })
})

describe('parseAppDataJson', () => {
  it('rechaza JSON inválido', () => {
    expect(() => parseAppDataJson('{ no json')).toThrow(
      'El archivo no es JSON válido.',
    )
  })

  it('parsea JSON válido', () => {
    const data = parseAppDataJson(
      JSON.stringify({ patients: [], doctors: [] }),
    )
    expect(data.patients).toEqual([])
  })
})
