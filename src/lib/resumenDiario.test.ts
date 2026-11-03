import { describe, it, expect } from 'vitest'
import { calcularResumenDiario } from './resumenDiario'
import { EMPTY_APP_DATA } from './appStateLoad'
import type { AppData } from '../types'

describe('calcularResumenDiario', () => {
  it('calcula totales de pagos y honorarios correctamente', () => {
    const data: AppData = {
      ...EMPTY_APP_DATA,
      doctors: [
        { id: 'doc1', apellido: 'Gómez', nombre: 'Juan', activo: true, porcentaje: 70 },
      ],
      payments: [
        {
          id: 'pay1',
          patientId: 'pac1',
          doctorId: 'doc1',
          citaId: null,
          monto: 10000,
          fecha: '2026-11-03T10:30:00',
          metodo: 'Efectivo',
          notas: '',
          registradoPor: 'Aguirre Mary',
        },
        {
          id: 'pay2',
          patientId: 'pac2',
          doctorId: 'doc1',
          citaId: null,
          monto: 5000,
          fecha: '2026-11-03T16:00:00',
          metodo: 'Transferencia',
          notas: '',
          registradoPor: 'Barua Andrea',
        },
      ],
      appointments: [
        {
          id: 'app1',
          patientId: 'pac1',
          doctorId: 'doc1',
          fechaHora: '2026-11-03T10:30:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'atendido',
        },
        {
          id: 'app2',
          patientId: 'pac2',
          doctorId: 'doc1',
          fechaHora: '2026-11-03T16:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'programado',
        },
      ],
    }

    const resumen = calcularResumenDiario(data, '2026-11-03')

    expect(resumen.fecha).toBe('2026-11-03')
    expect(resumen.total_cobrado).toBe(15000)
    expect(resumen.total_efectivo).toBe(10000)
    expect(resumen.total_transferencia).toBe(5000)
    expect(resumen.recaudacion_manana).toBe(10000)
    expect(resumen.recaudacion_tarde).toBe(5000)
    expect(resumen.recaudacion_mary).toBe(10000)
    expect(resumen.recaudacion_andrea).toBe(5000)
    expect(resumen.turnos_totales).toBe(2)
    expect(resumen.turnos_atendidos).toBe(1)
    expect(resumen.turnos_pendientes).toBe(1)
    expect(resumen.medicos_detalle).toHaveLength(1)
    expect(resumen.medicos_detalle[0].nombre).toBe('Gómez, Juan')
  })
})

