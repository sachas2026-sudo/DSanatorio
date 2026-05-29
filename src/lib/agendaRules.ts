import { eachDayOfInterval, endOfWeek, parseISO, startOfWeek } from 'date-fns'
import type { AppData, Doctor } from '../types'
import { planDoctorDay } from './weekSlots'

export { diaSemanaLabel, diaSemanaLabelLargo, DIAS_SEMANA_FORM } from './diasSemana'

function doctorTipoAgenda(doctor: Doctor | undefined): 'semanal' | 'mensual' {
  return doctor?.tipoAgenda === 'mensual' ? 'mensual' : 'semanal'
}

/** Lun–Sáb: la grilla de turnos y export semanal excluyen domingo. */
export function eachAgendaWeekDay(weekCursor: Date): Date[] {
  const start = startOfWeek(weekCursor, { weekStartsOn: 1 })
  const end = endOfWeek(weekCursor, { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end }).filter((d) => d.getDay() !== 0)
}

export function isAgendaWorkingDay(date: Date): boolean {
  return date.getDay() !== 0
}

export function validateAppointmentSlot(params: {
  fechaHora: string
  doctorId: string
  data: Pick<
    AppData,
    'horarios' | 'diasLibres' | 'atencionesMensuales' | 'doctors' | 'appointments'
  >
  excludeAppointmentId?: string
  duracionMinutos: number
}): { ok: true } | { ok: false; message: string } {
  const {
    fechaHora,
    doctorId,
    data,
    excludeAppointmentId,
    duracionMinutos,
  } = params

  let start: Date
  try {
    start = parseISO(fechaHora)
  } catch {
    return { ok: false, message: 'Fecha y hora inválidas.' }
  }
  if (Number.isNaN(start.getTime())) {
    return { ok: false, message: 'Fecha y hora inválidas.' }
  }

  const doctor = data.doctors.find((d) => d.id === doctorId)
  const mensual = doctorTipoAgenda(doctor) === 'mensual'

  if (!mensual) {
    const libre = data.diasLibres.some(
      (d) => d.doctorId === doctorId && d.diaSemana === start.getDay(),
    )
    if (libre) {
      return {
        ok: false,
        message: 'El médico no atiende ese día de la semana.',
      }
    }
  }

  const plan = planDoctorDay(doctorId, start, data)
  if (plan.kind === 'no-day') {
    return {
      ok: false,
      message: mensual
        ? 'Ese día no tiene atención configurada para el médico (revisá Atención mensual).'
        : 'Ese día de la semana no tiene franja horaria para el médico. Revisá horarios o elegí otro día.',
    }
  }
  if (plan.kind === 'no-doctor') {
    return { ok: false, message: 'Médico no válido.' }
  }

  const mins = start.getHours() * 60 + start.getMinutes()
  const endMins = mins + duracionMinutos
  const dentro = plan.ranges.some(([a, b]) => mins >= a && endMins <= b)
  if (!dentro) {
    return {
      ok: false,
      message: 'El turno no entra en el horario configurado del médico para ese día.',
    }
  }

  const end = new Date(start.getTime() + duracionMinutos * 60_000)
  const overlap = data.appointments.some((c) => {
    if (c.id === excludeAppointmentId) return false
    if (c.doctorId !== doctorId) return false
    if (c.estado === 'cancelado') return false
    const cs = parseISO(c.fechaHora)
    const ce = new Date(cs.getTime() + c.duracionMinutos * 60_000)
    return start < ce && end > cs
  })
  if (overlap) {
    return { ok: false, message: 'Ya existe otro turno que se superpone con este médico.' }
  }

  return { ok: true }
}
