import { describe, expect, it } from 'vitest'
import {
  computePagosDia,
  computePagosMesConDescuentos,
  computePanelCobranzasMes,
  filterPaymentsPanelMes,
  filterPaymentsMesCalendario,
} from './cobranzasMes'
import type { AppData } from '../types'

const baseDoctors = [
  {
    id: 'd1',
    nombre: 'Ana',
    apellido: 'García',
    matricula: '1',
    especialidad: 'Clínica',
    telefono: '',
    localidad: '',
    email: '',
    porcentaje: 10,
  },
  {
    id: 'd2',
    nombre: 'Luis',
    apellido: 'Pérez',
    matricula: '2',
    especialidad: 'Trauma',
    telefono: '',
    localidad: '',
    email: '',
    porcentaje: 20,
  },
]

const base: AppData = {
  patients: [],
  doctors: baseDoctors,
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [],
  payments: [],
  pagosCancelados: [],
  especialidadesCustom: [],
  obrasSocialesCustom: [],
  localidadesCustom: [],
  settings: {
    email: '',
    emailGerente: '',
    telefonoGerente: '',
    clave: '',
    telefono: '',
    cuit: '',
  },
}

describe('computePanelCobranzasMes', () => {
  const ref = new Date('2026-05-29T12:00:00')

  it('aplica % por médico como el PDF (total neto, no bruto)', () => {
    const data: AppData = {
      ...base,
      payments: [
        {
          id: 'p1',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 100_000,
          fecha: '2026-05-10T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
        {
          id: 'p2',
          patientId: 'x',
          doctorId: 'd2',
          citaId: null,
          monto: 200_000,
          fecha: '2026-05-12T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
      ],
    }
    const r = computePanelCobranzasMes(data, ref)
    // d1: 100000 - 10% = 90000; d2: 200000 - 20% = 160000
    expect(r.total).toBe(250_000)
    expect(r.totalFacturado).toBe(300_000)
    expect(r.cantidad).toBe(2)
  })

  it('solo incluye pagos hasta la fecha de atención (médico mensual)', () => {
    const data: AppData = {
      ...base,
      doctors: [
        {
          ...baseDoctors[0]!,
          tipoAgenda: 'mensual',
        },
      ],
      atencionesMensuales: [
        {
          id: 'a1',
          doctorId: 'd1',
          fecha: '2026-05-15',
          horaInicio: '09:00',
          horaFin: '12:00',
        },
      ],
      payments: [
        {
          id: 'p1',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 50_000,
          fecha: '2026-05-05T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
        {
          id: 'p2',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 30_000,
          fecha: '2026-05-20T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
      ],
    }
    const filtered = filterPaymentsPanelMes(data, ref)
    expect(filtered.map((p) => p.id)).toEqual(['p1'])
    expect(computePanelCobranzasMes(data, ref).total).toBe(45_000)
  })
})

describe('computePagosMesConDescuentos', () => {
  const ref = new Date('2026-05-29T12:00:00')

  it('incluye todos los pagos del mes calendario con % por médico', () => {
    const data: AppData = {
      ...base,
      doctors: [
        {
          ...baseDoctors[0]!,
          tipoAgenda: 'mensual',
        },
      ],
      atencionesMensuales: [
        {
          id: 'a1',
          doctorId: 'd1',
          fecha: '2026-05-15',
          horaInicio: '09:00',
          horaFin: '12:00',
        },
      ],
      payments: [
        {
          id: 'p1',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 50_000,
          fecha: '2026-05-05T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
        {
          id: 'p2',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 30_000,
          fecha: '2026-05-20T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
      ],
    }
    expect(filterPaymentsMesCalendario(data, ref).map((p) => p.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(computePagosMesConDescuentos(data, ref).total).toBe(72_000)
  })
})

describe('computePagosDia', () => {
  const ref = new Date('2026-05-29T12:00:00')

  it('incluye bruto y neto con % por médico', () => {
    const data: AppData = {
      ...base,
      payments: [
        {
          id: 'p1',
          patientId: 'x',
          doctorId: 'd1',
          citaId: null,
          monto: 100_000,
          fecha: '2026-05-29T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
        {
          id: 'p2',
          patientId: 'x',
          doctorId: 'd2',
          citaId: null,
          monto: 50_000,
          fecha: '2026-05-28T10:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
      ],
    }
    const r = computePagosDia(data, ref)
    expect(r.total).toBe(100_000)
    expect(r.totalConDescuentos).toBe(90_000)
    expect(r.cantidad).toBe(1)
  })
})
