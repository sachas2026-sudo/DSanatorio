import { isBefore, parseISO, startOfDay } from 'date-fns'
import type { Appointment, AppointmentEstado } from '../types'

export const AGENDA_ESTADOS: { value: AppointmentEstado; label: string }[] = [
  { value: 'programado', label: 'Programado' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'cancelado', label: 'Cancelado' },
]

export const AGENDA_COMPACT_ESTADO_THRESHOLD = 8

const estadoAbreviado: Record<AppointmentEstado, string> = {
  programado: 'Prog.',
  atendido: 'Atend.',
  cancelado: 'Canc.',
}

/** En agenda: turnos de días anteriores se muestran como atendidos (salvo cancelados). */
export function effectiveCitaEstadoForDisplay(
  c: Appointment,
  refDate: Date = new Date(),
): AppointmentEstado {
  if (c.estado === 'cancelado') return 'cancelado'
  const turnoDay = startOfDay(parseISO(c.fechaHora))
  const hoy = startOfDay(refDate)
  if (isBefore(turnoDay, hoy)) return 'atendido'
  return c.estado
}

export function dayCitaEstadoParts(
  c: Appointment,
  isPagado: boolean,
  refDate?: Date,
): string[] {
  const estado = effectiveCitaEstadoForDisplay(c, refDate)
  const parts: string[] = []
  if (estado !== 'programado') {
    const base = AGENDA_ESTADOS.find((e) => e.value === estado)?.label ?? estado
    parts.push(base)
  }
  if (/urgencia/i.test(c.notas)) parts.push('Urgencia')
  if (isPagado) parts.push('Pagado')
  return parts
}

export function formatDayCitaEstado(
  c: Appointment,
  isPagado: boolean,
  compact: boolean,
  refDate?: Date,
): string {
  const estado = effectiveCitaEstadoForDisplay(c, refDate)
  if (!compact) return dayCitaEstadoParts(c, isPagado, refDate).join(' - ')
  const parts: string[] = []
  if (estado !== 'programado') {
    parts.push(estadoAbreviado[estado] ?? estado)
  }
  if (/urgencia/i.test(c.notas)) parts.push('Urg.')
  if (isPagado) parts.push('Pag.')
  return parts.join(' · ')
}

export function splitMedicoPillLabel(label: string): {
  name: string
  esp: string | null
} {
  const sep = label.indexOf(' - ')
  if (sep === -1) return { name: label, esp: null }
  return { name: label.slice(0, sep), esp: label.slice(sep + 3) }
}
