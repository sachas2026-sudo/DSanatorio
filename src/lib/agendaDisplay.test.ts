import { describe, expect, it } from 'vitest'
import {
  dayCitaEstadoParts,
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
  it('dayCitaEstadoParts incluye urgencia y pagado', () => {
    expect(dayCitaEstadoParts(cita, true)).toEqual([
      'Programado',
      'Urgencia',
      'Pagado',
    ])
  })

  it('formatDayCitaEstado compacto abrevia', () => {
    expect(formatDayCitaEstado(cita, false, true)).toBe('Prog. · Urg.')
  })

  it('splitMedicoPillLabel separa especialidad', () => {
    expect(splitMedicoPillLabel('García - Cardiología')).toEqual({
      name: 'García',
      esp: 'Cardiología',
    })
  })
})
