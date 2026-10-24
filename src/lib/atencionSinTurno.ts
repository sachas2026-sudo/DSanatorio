import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { createId } from './id'
import type {
  AtencionSinTurnoFila,
  AtencionSinTurnoListado,
  Payment,
} from '../types'

/** Marca legacy en pagos migrados desde versiones anteriores. */
export const ATENCION_SIN_TURNO_NOTAS = 'Atención sin turno'

export function isAtencionSinTurnoPayment(p: Payment): boolean {
  if (p.citaId != null) return false
  const n = (p.notas ?? '').trim().toLowerCase()
  return n === ATENCION_SIN_TURNO_NOTAS.toLowerCase()
}

export function paymentFechaYmd(p: Payment): string {
  return format(parseISO(p.fecha), 'yyyy-MM-dd')
}

export function formatAtencionSinTurnoFechaLabel(fechaYmd: string): string {
  const [y, m, d] = fechaYmd.split('-').map(Number)
  if (!y || !m || !d) return fechaYmd
  return format(new Date(y, m - 1, d, 12, 0, 0), 'dd-MM-yy', { locale: es })
}

export function listAtencionSinTurnoHistorialDates(
  listados: AtencionSinTurnoListado[],
  doctorId: string,
): string[] {
  if (!doctorId) return []
  const dates = new Set<string>()
  for (const l of listados) {
    if (l.doctorId !== doctorId) continue
    dates.add(l.fecha)
  }
  return [...dates].sort((a, b) => b.localeCompare(a))
}

export function atencionSinTurnoListadoForSession(
  listados: AtencionSinTurnoListado[],
  doctorId: string,
  fechaYmd: string,
): AtencionSinTurnoListado | null {
  return (
    listados.find(
      (l) => l.doctorId === doctorId && l.fecha === fechaYmd,
    ) ?? null
  )
}

export function replaceAtencionSinTurnoListado(
  listados: AtencionSinTurnoListado[],
  payload: {
    doctorId: string
    fecha: string
    filas: AtencionSinTurnoFila[]
  },
): AtencionSinTurnoListado[] {
  const rest = listados.filter(
    (l) => !(l.doctorId === payload.doctorId && l.fecha === payload.fecha),
  )
  if (payload.filas.length === 0) return rest
  const next: AtencionSinTurnoListado = {
    id: createId(),
    doctorId: payload.doctorId,
    fecha: payload.fecha,
    filas: payload.filas,
    guardadoEn: new Date().toISOString(),
  }
  return [...rest, next]
}

export function deleteAtencionSinTurnoListado(
  listados: AtencionSinTurnoListado[],
  doctorId: string,
  fechaYmd: string,
): AtencionSinTurnoListado[] {
  return listados.filter(
    (l) => !(l.doctorId === doctorId && l.fecha === fechaYmd),
  )
}

function listadoSessionKey(listado: AtencionSinTurnoListado): string {
  return `${listado.doctorId}|${listado.fecha}`
}

function paymentsToListado(
  doctorId: string,
  fecha: string,
  group: Payment[],
): AtencionSinTurnoListado {
  return {
    id: createId(),
    doctorId,
    fecha,
    filas: group.map((p) => ({
      patientId: p.patientId,
      monto: p.monto,
    })),
    guardadoEn: group[0]?.fecha ?? new Date().toISOString(),
  }
}

/** Migra listados viejos guardados como pagos y los saca de Pagos. */
export function mergeAtencionSinTurnoStorage(
  listados: AtencionSinTurnoListado[],
  payments: Payment[],
): { listados: AtencionSinTurnoListado[]; payments: Payment[] } {
  const astPayments = payments.filter(isAtencionSinTurnoPayment)
  const remainingPayments = payments.filter((p) => !isAtencionSinTurnoPayment(p))

  if (astPayments.length === 0) {
    return { listados, payments: remainingPayments }
  }

  const existingSessions = new Set(listados.map(listadoSessionKey))
  const orphansBySession = new Map<string, Payment[]>()
  for (const p of astPayments) {
    const key = `${p.doctorId}|${paymentFechaYmd(p)}`
    if (existingSessions.has(key)) continue
    const group = orphansBySession.get(key) ?? []
    group.push(p)
    orphansBySession.set(key, group)
  }

  if (orphansBySession.size === 0) {
    return { listados, payments: remainingPayments }
  }

  const migrated: AtencionSinTurnoListado[] = [...listados]
  for (const [key, group] of orphansBySession) {
    const [doctorId, fecha] = key.split('|')
    if (!doctorId || !fecha) continue
    migrated.push(paymentsToListado(doctorId, fecha, group))
  }

  return { listados: migrated, payments: remainingPayments }
}
