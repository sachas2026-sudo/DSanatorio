import type { Appointment, AppointmentEstado, Payment } from '../types'

type CompactStatus = {
  label: string
  marker: string
}

export function compactAppointmentStatus(
  status: AppointmentEstado,
): CompactStatus {
  switch (status) {
    case 'atendido':
      return { label: 'Atendido', marker: '✓' }
    case 'cancelado':
      return { label: 'Cancelado', marker: '×' }
    case 'programado':
      return { label: 'Programado', marker: '•' }
  }
}

export function paymentsWithoutAppointment(
  appointments: readonly Pick<Appointment, 'id'>[],
  payments: readonly Payment[],
): Payment[] {
  const appointmentIds = new Set(appointments.map((appointment) => appointment.id))
  return payments.filter(
    (payment) => !payment.citaId || !appointmentIds.has(payment.citaId),
  )
}