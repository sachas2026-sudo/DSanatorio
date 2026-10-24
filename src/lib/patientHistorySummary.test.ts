import { describe, expect, it } from 'vitest'
import type { Payment } from '../types'
import {
  compactAppointmentStatus,
  paymentsWithoutAppointment,
} from './patientHistorySummary'

describe('compactAppointmentStatus', () => {
  it('gives each appointment state a matching label and marker', () => {
    expect(compactAppointmentStatus('atendido')).toEqual({
      label: 'Atendido',
      marker: '✓',
    })
    expect(compactAppointmentStatus('programado')).toEqual({
      label: 'Programado',
      marker: '•',
    })
    expect(compactAppointmentStatus('cancelado')).toEqual({
      label: 'Cancelado',
      marker: '×',
    })
  })
})

describe('paymentsWithoutAppointment', () => {
  it('returns payments with no citation or a citation missing from the patient history', () => {
    const payments: Payment[] = [
      { id: 'linked', citaId: 'appointment-1' },
      { id: 'no-appointment', citaId: null },
      { id: 'missing-appointment', citaId: 'deleted-appointment' },
    ].map((payment) => ({
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      monto: 100,
      fecha: '2026-10-05',
      metodo: 'Efectivo',
      notas: '',
      porcentajeAplicado: undefined,
      ...payment,
    }))

    const result = paymentsWithoutAppointment([{ id: 'appointment-1' }], payments)

    expect(result.map((payment) => payment.id)).toEqual([
      'no-appointment',
      'missing-appointment',
    ])
  })
})