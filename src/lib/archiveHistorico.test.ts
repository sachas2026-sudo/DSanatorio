import { describe, expect, it } from 'vitest'
import type { AppData } from '../types'
import {
  defaultHistoricoCutoffDate,
  hasArchiveableRecords,
  previewArchiveHistorico,
  splitArchiveHistorico,
} from './archiveHistorico'

const base: AppData = {
  patients: [],
  doctors: [],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [
    {
      id: 'a1',
      patientId: 'p1',
      doctorId: 'd1',
      fechaHora: '2022-06-01T10:00:00',
      duracionMinutos: 30,
      notas: '',
      estado: 'atendido',
    },
    {
      id: 'a2',
      patientId: 'p1',
      doctorId: 'd1',
      fechaHora: '2024-06-01T10:00:00',
      duracionMinutos: 30,
      notas: '',
      estado: 'programado',
    },
  ],
  payments: [
    {
      id: 'pay1',
      patientId: 'p1',
      doctorId: 'd1',
      citaId: 'a1',
      monto: 100,
      fecha: '2022-06-01T12:00:00',
      metodo: 'Efectivo',
      notas: '',
    },
    {
      id: 'pay2',
      patientId: 'p1',
      doctorId: 'd1',
      citaId: 'a2',
      monto: 200,
      fecha: '2024-06-01T12:00:00',
      metodo: 'Efectivo',
      notas: '',
    },
  ],
  atencionesSinTurno: [
    {
      id: 'st1',
      doctorId: 'd1',
      fecha: '2022-05-01',
      filas: [],
      guardadoEn: '2022-05-01T18:00:00',
    },
  ],
  pagosCancelados: [
    {
      id: 'c1',
      motivo: 'otros',
      canceladoEn: '2021-12-01T10:00:00',
      payment: {
        id: 'pay0',
        patientId: 'p1',
        doctorId: 'd1',
        citaId: null,
        monto: 50,
        fecha: '2021-11-01T12:00:00',
        metodo: '',
        notas: '',
      },
      appointment: null,
      notasOtros: '',
    },
  ],
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

describe('archiveHistorico', () => {
  it('defaultHistoricoCutoffDate sugiere 1 de enero hace 2 años', () => {
    expect(defaultHistoricoCutoffDate(new Date('2026-06-04T12:00:00'))).toBe(
      '2024-01-01',
    )
  })

  it('previewArchiveHistorico cuenta registros anteriores al corte', () => {
    const stats = previewArchiveHistorico(base, '2024-01-01')
    expect(stats.appointments).toBe(1)
    expect(stats.payments).toBe(1)
    expect(stats.pagosCancelados).toBe(1)
    expect(stats.atencionesSinTurno).toBe(1)
    expect(stats.keptAppointments).toBe(1)
    expect(stats.keptPayments).toBe(1)
    expect(hasArchiveableRecords(stats)).toBe(true)
  })

  it('splitArchiveHistorico separa activo e histórico', () => {
    const { active, archive } = splitArchiveHistorico(base, '2024-01-01')
    expect(active.appointments).toHaveLength(1)
    expect(active.appointments[0]!.id).toBe('a2')
    expect(active.payments).toHaveLength(1)
    expect(active.pagosCancelados).toHaveLength(0)
    expect(archive.appointments).toHaveLength(1)
    expect(archive.payments).toHaveLength(1)
    expect(archive.cutoffDate).toBe('2024-01-01')
  })
})
