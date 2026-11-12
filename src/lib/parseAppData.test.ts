import { describe, expect, it } from 'vitest'
import {
  asNumber,
  asString,
  isRecord,
  nonEmptyId,
  normalizePagosCancelados,
  parseAppDataJson,
  parseAppDataRecord,
  parseAppDataRecordWithReport,
  hasIntegrityIssues,
  formatIntegrityAlert,
  parseDoctor,
  parsePatient,
  parsePayment,
  parseAppointment,
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

describe('parseAppointment', () => {
  const base = {
    id: 'a1',
    patientId: 'p1',
    doctorId: 'd1',
    fechaHora: '2026-05-04T09:00:00.000Z',
  }

  it('lee motivoConsulta2 cuando viene', () => {
    expect(
      parseAppointment({ ...base, notas: 'Consulta', motivoConsulta2: ' Control ' }),
    ).toMatchObject({ notas: 'Consulta', motivoConsulta2: 'Control' })
  })

  it('omite motivoConsulta2 vacío y en turnos viejos', () => {
    expect(parseAppointment({ ...base, notas: 'Consulta' })).not.toHaveProperty(
      'motivoConsulta2',
    )
    expect(
      parseAppointment({ ...base, notas: 'Consulta', motivoConsulta2: '   ' }),
    ).not.toHaveProperty('motivoConsulta2')
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
  it('acepta porcentaje con decimales', () => {
    expect(parseDoctor({ id: 'd1', porcentaje: 10.28 })?.porcentaje).toBe(10.28)
    expect(parseDoctor({ id: 'd1', porcentaje: '15,5' })?.porcentaje).toBe(15.5)
  })

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

  it('guarda alias opcional', () => {
    expect(parseDoctor({ id: 'd1', alias: '  DR-G  ' })?.alias).toBe('DR-G')
    expect(parseDoctor({ id: 'd1', alias: '   ' })?.alias).toBe('')
  })

  it('parsea valor, particular y cuidar como enteros no negativos acotados', () => {
    const doc = parseDoctor({
      id: 'd1',
      valor: 15000,
      particular: '25000',
      cuidar: 10000,
    })
    expect(doc?.valor).toBe(15000)
    expect(doc?.particular).toBe(25000)
    expect(doc?.cuidar).toBe(10000)

    const docLegacy = parseDoctor({ id: 'd2' })
    expect(docLegacy?.valor).toBe(0)
    expect(docLegacy?.particular).toBe(0)
    expect(docLegacy?.cuidar).toBe(0)

    const docInvalid = parseDoctor({
      id: 'd3',
      valor: -500,
      particular: 999_999_999,
      cuidar: 'abc',
    })
    expect(docInvalid?.valor).toBe(0)
    expect(docInvalid?.particular).toBe(100_000_000)
    expect(docInvalid?.cuidar).toBe(0)
  })

  it('conserva honorarios vacíos como null', () => {
    const doc = parseDoctor({
      id: 'd-empty',
      valor: null,
      particular: null,
      cuidar: null,
    })
    expect(doc?.porcentaje).toBeUndefined()
    expect(doc?.valor).toBeNull()
    expect(doc?.particular).toBeNull()
    expect(doc?.cuidar).toBeNull()
  })

  it('convierte obrasSociales viejas (strings sueltos) al nuevo formato con porcentaje 0 y monto 0', () => {
    const doc = parseDoctor({
      id: 'd-os-leg',
      obrasSociales: ['Particular', 'OSDE', 'Particular', '  '],
    })
    expect(doc?.obrasSociales).toEqual([
      { nombre: 'Particular', porcentaje: 0, monto: 0 },
      { nombre: 'OSDE', porcentaje: 0, monto: 0 },
    ])
  })

  it('parsea obrasSociales enteras y elimina duplicados', () => {
    const doc = parseDoctor({
      id: 'd-os-new',
      obrasSociales: [
        { nombre: 'OSDE', porcentaje: 15.54, monto: 12000 },
        { nombre: 'osde', porcentaje: 10, monto: 5000 }, // duplicado case-insensitive
        { nombre: '  ', porcentaje: 20, monto: 3000 }, // vacío
        { nombre: 'Swiss Medical', porcentaje: 150, monto: -500 },
      ],
    })
    expect(doc?.obrasSociales).toEqual([
      { nombre: 'OSDE', porcentaje: 16, monto: 12000 },
      { nombre: 'Swiss Medical', porcentaje: 150, monto: 0 },
    ])
  })

  it('conserva montos y porcentajes altos al volver a abrir la ficha', () => {
    const doc = parseDoctor({
      id: 'd-os-high',
      obrasSociales: [
        { nombre: 'IPS', porcentaje: 250, monto: 9_999_999 },
        { nombre: 'OSDE', porcentaje: 1000, monto: 999_999_999 },
      ],
    })

    expect(doc?.obrasSociales).toEqual([
      { nombre: 'IPS', porcentaje: 250, monto: 9_999_999 },
      { nombre: 'OSDE', porcentaje: 1000, monto: 999_999_999 },
    ])
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

  it('parsea porcentajeAplicado', () => {
    expect(
      parsePayment({
        id: 'pay1',
        patientId: 'p1',
        doctorId: 'd1',
        fecha: '2026-01-01',
        monto: 100,
        porcentajeAplicado: 12,
      }),
    ).toMatchObject({ porcentajeAplicado: 12 })
  })

  it('parsea registradoPor, modificadoPor y modificadoEn', () => {
    expect(
      parsePayment({
        id: 'pay1',
        patientId: 'p1',
        doctorId: 'd1',
        fecha: '2026-01-01',
        registradoPor: 'Barua Andrea',
        modificadoPor: 'Aguirre Mary',
        modificadoEn: '2026-01-02T10:00:00.000Z',
      }),
    ).toMatchObject({
      registradoPor: 'Barua Andrea',
      modificadoPor: 'Aguirre Mary',
      modificadoEn: '2026-01-02T10:00:00.000Z',
    })
  })
})

describe('normalizePagosCancelados', () => {
  it('migra eliminadoEn a canceladoEn y conserva canceladoPor', () => {
    const rows = normalizePagosCancelados([
      {
        id: 'pc1',
        motivo: 'cancelacion_paciente',
        eliminadoEn: '2026-01-02T10:00:00.000Z',
        canceladoPor: 'Barua Andrea',
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
    expect(rows[0]?.canceladoPor).toBe('Barua Andrea')
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
      supabaseUrl: 'https://mzfyzabgdlzqkvufqrxh.supabase.co',
      supabaseAnonKey: 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM',
      supabaseServiceRoleKey: '',
      supabaseAutoSync: true,
      supabaseUltimaSync: '',
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

  it('conserva turnos y pagos aunque falte paciente o médico en la base', () => {
    const data = parseAppDataRecord({
      patients: [{ id: 'p1', nombre: 'Ana', apellido: 'López' }],
      doctors: [{ id: 'd1', nombre: 'Dr', apellido: 'House' }],
      appointments: [
        {
          id: 'c1',
          patientId: 'p1',
          doctorId: 'd1',
          fechaHora: '2026-05-01T10:00:00',
        },
        {
          id: 'c2',
          patientId: 'p-missing',
          doctorId: 'd1',
          fechaHora: '2026-05-01T11:00:00',
        },
      ],
      payments: [
        {
          id: 'pay1',
          patientId: 'p1',
          doctorId: 'd1',
          citaId: 'c1',
          monto: 100,
          fecha: '2026-05-01T10:30:00',
        },
        {
          id: 'pay2',
          patientId: 'p1',
          doctorId: 'd-missing',
          monto: 50,
          fecha: '2026-05-01T11:30:00',
        },
        {
          id: 'pay3',
          patientId: 'p1',
          doctorId: 'd1',
          citaId: 'c-missing',
          monto: 25,
          fecha: '2026-05-01T12:00:00',
        },
      ],
    })
    expect(data.appointments).toHaveLength(2)
    expect(data.payments).toHaveLength(3)
    expect(data.payments.find((p) => p.id === 'pay2')?.doctorId).toBe('d-missing')
    expect(data.payments.find((p) => p.id === 'pay3')?.citaId).toBeNull()
  })

  it('conserva diasLibres aunque falte el médico en la base', () => {
    const data = parseAppDataRecord({
      ...minimal,
      diasLibres: [
        { id: 'dl1', doctorId: 'd1', fecha: '2026-06-01' },
        { id: 'dl2', doctorId: 'd-missing', fecha: '2026-06-02' },
      ],
    })
    expect(data.diasLibres).toHaveLength(2)
  })

  it('preserva configuraciones de permisos de usuarios y modificación de mes', () => {
    const data = parseAppDataRecord({
      ...minimal,
      settings: {
        email: 'test@example.com',
        secretariaPuedeModificarMesActual: true,
        secretariaPuedeModificarTurnosOtrosUsuarios: true,
        mostrarAccionesEnListaPagos: true,
      },
    })
    expect(data.settings.secretariaPuedeModificarMesActual).toBe(true)
    expect(data.settings.secretariaPuedeModificarTurnosOtrosUsuarios).toBe(true)
    expect(data.settings.mostrarAccionesEnListaPagos).toBe(true)
  })
})

describe('parseAppDataRecordWithReport', () => {
  it('informa filas inválidas y referencias huérfanas', () => {
    const { data, report } = parseAppDataRecordWithReport({
      patients: [{ id: 'p1', nombre: 'Ana', apellido: 'López' }, { nombre: 'Sin id' }],
      doctors: [{ id: 'd1', nombre: 'Dr', apellido: 'House' }],
      appointments: [
        {
          id: 'c1',
          patientId: 'p1',
          doctorId: 'd1',
          fechaHora: '2026-05-01T10:00:00',
        },
        {
          id: 'c2',
          patientId: 'p-missing',
          doctorId: 'd1',
          fechaHora: '2026-05-02T11:00:00',
        },
      ],
    })
    expect(data.appointments).toHaveLength(2)
    expect(hasIntegrityIssues(report)).toBe(true)
    expect(formatIntegrityAlert(report)).toContain('paciente(s) inválido(s)')
  })
})

describe('parseAppDataJson', () => {
  it('rechaza JSON inválido', () => {
    expect(() => parseAppDataJson('{ no json')).toThrow(
      'El archivo no es JSON válido.',
    )
  })

  it('parsea JSON válido y respeta permisos de configuración', () => {
    const data = parseAppDataJson(
      JSON.stringify({
        patients: [],
        doctors: [],
        settings: {
          mostrarAccionesEnListaPagos: true,
          secretariaPuedeModificarMesActual: true,
          secretariaPuedeModificarTurnosOtrosUsuarios: true,
        },
      }),
    )
    expect(data.patients).toEqual([])
    expect(data.settings.mostrarAccionesEnListaPagos).toBe(true)
    expect(data.settings.secretariaPuedeModificarMesActual).toBe(true)
    expect(data.settings.secretariaPuedeModificarTurnosOtrosUsuarios).toBe(true)
  })
})
