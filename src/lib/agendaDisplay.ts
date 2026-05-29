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

export function dayCitaEstadoParts(c: Appointment, isPagado: boolean): string[] {
  const base =
    AGENDA_ESTADOS.find((e) => e.value === c.estado)?.label ?? c.estado
  const parts = [base]
  if (/urgencia/i.test(c.notas)) parts.push('Urgencia')
  if (isPagado) parts.push('Pagado')
  return parts
}

export function formatDayCitaEstado(
  c: Appointment,
  isPagado: boolean,
  compact: boolean,
): string {
  if (!compact) return dayCitaEstadoParts(c, isPagado).join(' - ')
  const parts = [estadoAbreviado[c.estado] ?? c.estado]
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
