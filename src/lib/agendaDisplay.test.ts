import { describe, expect, it } from 'vitest'
import {
  dayCitaEstadoParts,
  effectiveCitaEstadoForDisplay,
  formatDayCitaEstado,
  splitMedicoPillLabel,
} from './agendaDisplay'
import type { Appointment } from '../types'

const cita: Appointment = {
  id: '1',
  patientId: 'p1',
  doctorId: 'd1',
  fechaHora: '2026-05-29T10:00:00',
  duracionMinutos: 30,
  estado: 'programado',
  notas: 'Urgencia',
}

describe('agendaDisplay', () => {
  const mismoDia = new Date('2026-05-29T12:00:00')

  it('dayCitaEstadoParts incluye urgencia y pagado sin Programado', () => {
    expect(dayCitaEstadoParts(cita, true, mismoDia)).toEqual([
      'Urgencia',
      'Pagado',
    ])
    expect(dayCitaEstadoParts(cita, false, mismoDia)).toEqual(['Urgencia'])
    expect(
      dayCitaEstadoParts(
        { ...cita, notas: '', estado: 'programado' },
        false,
        mismoDia,
      ),
    ).toEqual([])
  })

  it('formatDayCitaEstado compacto abrevia sin Prog.', () => {
    expect(formatDayCitaEstado(cita, false, true, mismoDia)).toBe('Urg.')
    expect(formatDayCitaEstado(cita, true, true, mismoDia)).toBe('Urg. · Pag.')
  })

  it('turno de día anterior se muestra como atendido', () => {
    const ref = new Date('2026-05-31T12:00:00')
    expect(effectiveCitaEstadoForDisplay(cita, ref)).toBe('atendido')
    expect(formatDayCitaEstado(cita, false, false, ref)).toBe('Atendido - Urgencia')
  })

  it('turno cancelado en día anterior sigue cancelado', () => {
    const ref = new Date('2026-05-31T12:00:00')
    const cancelada = { ...cita, estado: 'cancelado' as const }
    expect(effectiveCitaEstadoForDisplay(cancelada, ref)).toBe('cancelado')
  })

  it('turno de hoy mantiene estado guardado', () => {
    const ref = new Date('2026-05-29T18:00:00')
    expect(effectiveCitaEstadoForDisplay(cita, ref)).toBe('programado')
  })

  it('splitMedicoPillLabel separa especialidad', () => {
    expect(splitMedicoPillLabel('García - Cardiología')).toEqual({
      name: 'García',
      esp: 'Cardiología',
    })
  })
})
