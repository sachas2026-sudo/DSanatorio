import { describe, expect, it } from 'vitest'
import { rankMotivosConsultaMes } from './homeInsights'
import type { Appointment } from '../types'

function appointment(partial: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    patientId: 'p1',
    doctorId: 'd1',
    fechaHora: '2026-08-15T10:00:00.000Z',
    duracionMinutos: 30,
    estado: 'atendido',
    notas: 'Consulta',
    ...partial,
  }
}

describe('rankMotivosConsultaMes', () => {
  it('ordena los motivos del mes y excluye turnos cancelados', () => {
    const rows = rankMotivosConsultaMes([
      appointment({ id: 'a1', notas: 'Control' }),
      appointment({ id: 'a2', notas: 'Consulta' }),
      appointment({ id: 'a3', notas: 'Consulta' }),
      appointment({ id: 'a4', notas: 'Laboratorio', estado: 'cancelado' }),
      appointment({ id: 'a5', notas: 'Consulta', fechaHora: '2026-07-15T10:00:00.000Z' }),
    ], [], new Date('2026-08-20T12:00:00.000Z'))

    expect(rows).toEqual([
      { nombre: 'Consulta', cantidad: 2 },
      { nombre: 'Control', cantidad: 1 },
    ])
  })
})
