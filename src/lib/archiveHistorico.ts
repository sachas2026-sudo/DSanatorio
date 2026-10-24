import { parseISO, startOfDay } from 'date-fns'
import type {
  AppData,
  Appointment,
  AtencionSinTurnoListado,
  PagoCancelado,
  Payment,
} from '../types'

export const HISTORICO_ARCHIVE_VERSION = 1 as const
export const HISTORICO_DIR_NAME = 'historico'
export const DEFAULT_HISTORICO_YEARS_KEPT = 2

export interface HistoricoArchivePayload {
  version: typeof HISTORICO_ARCHIVE_VERSION
  /** Registros con fecha estrictamente anterior a esta (YYYY-MM-DD). */
  cutoffDate: string
  archivedAt: string
  appointments: Appointment[]
  payments: Payment[]
  pagosCancelados: PagoCancelado[]
  atencionesSinTurno: AtencionSinTurnoListado[]
}

export type ArchiveHistoricoStats = {
  cutoffDate: string
  appointments: number
  payments: number
  pagosCancelados: number
  atencionesSinTurno: number
  keptAppointments: number
  keptPayments: number
}

const CUTOFF_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidHistoricoCutoffDate(date: string): boolean {
  return CUTOFF_RE.test(date)
}

/** Fecha sugerida: 1 de enero de hace N años completos. */
export function defaultHistoricoCutoffDate(
  ref = new Date(),
  yearsKept = DEFAULT_HISTORICO_YEARS_KEPT,
): string {
  const y = ref.getFullYear() - yearsKept
  return `${y}-01-01`
}

export function historicoArchiveFilename(cutoffDate: string): string {
  return `sanatorio-historico-antes-de-${cutoffDate}.json`
}

function cutoffInstant(cutoffDate: string): Date {
  return startOfDay(parseISO(`${cutoffDate}T12:00:00`))
}

function recordInstant(iso: string): Date {
  const normalized = iso.includes('T') ? iso : `${iso}T12:00:00`
  return parseISO(normalized)
}

function isStrictlyBefore(iso: string, cutoff: Date): boolean {
  return recordInstant(iso).getTime() < cutoff.getTime()
}

function partitionAppointments(
  items: Appointment[],
  cutoff: Date,
): { archived: Appointment[]; kept: Appointment[] } {
  const archived: Appointment[] = []
  const kept: Appointment[] = []
  for (const item of items) {
    if (isStrictlyBefore(item.fechaHora, cutoff)) archived.push(item)
    else kept.push(item)
  }
  return { archived, kept }
}

function partitionPayments(
  items: Payment[],
  cutoff: Date,
): { archived: Payment[]; kept: Payment[] } {
  const archived: Payment[] = []
  const kept: Payment[] = []
  for (const item of items) {
    if (isStrictlyBefore(item.fecha, cutoff)) archived.push(item)
    else kept.push(item)
  }
  return { archived, kept }
}

function partitionPagosCancelados(
  items: PagoCancelado[],
  cutoff: Date,
): { archived: PagoCancelado[]; kept: PagoCancelado[] } {
  const archived: PagoCancelado[] = []
  const kept: PagoCancelado[] = []
  for (const item of items) {
    const ref = item.canceladoEn || item.payment.fecha
    if (isStrictlyBefore(ref, cutoff)) archived.push(item)
    else kept.push(item)
  }
  return { archived, kept }
}

function partitionAtencionesSinTurno(
  items: AtencionSinTurnoListado[],
  cutoff: Date,
): { archived: AtencionSinTurnoListado[]; kept: AtencionSinTurnoListado[] } {
  const archived: AtencionSinTurnoListado[] = []
  const kept: AtencionSinTurnoListado[] = []
  for (const item of items) {
    if (isStrictlyBefore(item.fecha, cutoff)) archived.push(item)
    else kept.push(item)
  }
  return { archived, kept }
}

export function previewArchiveHistorico(
  data: AppData,
  cutoffDate: string,
): ArchiveHistoricoStats {
  if (!isValidHistoricoCutoffDate(cutoffDate)) {
    throw new Error('Fecha de corte inválida (use AAAA-MM-DD).')
  }
  const cutoff = cutoffInstant(cutoffDate)
  const appts = partitionAppointments(data.appointments, cutoff)
  const pays = partitionPayments(data.payments, cutoff)
  const cancel = partitionPagosCancelados(data.pagosCancelados, cutoff)
  const sinTurno = partitionAtencionesSinTurno(data.atencionesSinTurno, cutoff)
  return {
    cutoffDate,
    appointments: appts.archived.length,
    payments: pays.archived.length,
    pagosCancelados: cancel.archived.length,
    atencionesSinTurno: sinTurno.archived.length,
    keptAppointments: appts.kept.length,
    keptPayments: pays.kept.length,
  }
}

export function splitArchiveHistorico(
  data: AppData,
  cutoffDate: string,
  archivedAt = new Date().toISOString(),
): {
  active: AppData
  archive: HistoricoArchivePayload
  stats: ArchiveHistoricoStats
} {
  const stats = previewArchiveHistorico(data, cutoffDate)
  const cutoff = cutoffInstant(cutoffDate)
  const appts = partitionAppointments(data.appointments, cutoff)
  const pays = partitionPayments(data.payments, cutoff)
  const cancel = partitionPagosCancelados(data.pagosCancelados, cutoff)
  const sinTurno = partitionAtencionesSinTurno(data.atencionesSinTurno, cutoff)

  return {
    active: {
      ...data,
      appointments: appts.kept,
      payments: pays.kept,
      pagosCancelados: cancel.kept,
      atencionesSinTurno: sinTurno.kept,
    },
    archive: {
      version: HISTORICO_ARCHIVE_VERSION,
      cutoffDate,
      archivedAt,
      appointments: appts.archived,
      payments: pays.archived,
      pagosCancelados: cancel.archived,
      atencionesSinTurno: sinTurno.archived,
    },
    stats,
  }
}

export function mergeHistoricoArchives(
  existing: HistoricoArchivePayload,
  incoming: HistoricoArchivePayload,
): HistoricoArchivePayload {
  if (existing.cutoffDate !== incoming.cutoffDate) {
    throw new Error('No se pueden fusionar archivos históricos con distinta fecha de corte.')
  }
  return {
    version: HISTORICO_ARCHIVE_VERSION,
    cutoffDate: existing.cutoffDate,
    archivedAt: incoming.archivedAt,
    appointments: [...existing.appointments, ...incoming.appointments],
    payments: [...existing.payments, ...incoming.payments],
    pagosCancelados: [...existing.pagosCancelados, ...incoming.pagosCancelados],
    atencionesSinTurno: [
      ...existing.atencionesSinTurno,
      ...incoming.atencionesSinTurno,
    ],
  }
}

export function hasArchiveableRecords(stats: ArchiveHistoricoStats): boolean {
  return (
    stats.appointments > 0 ||
    stats.payments > 0 ||
    stats.pagosCancelados > 0 ||
    stats.atencionesSinTurno > 0
  )
}
