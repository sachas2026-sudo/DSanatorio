import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export const PAGOS_GERENCIA_EXCEL_LAST_EXPORT_KEY =
  'pagos-gerencia-excel-last-export-v3'

export type PagosGerenciaExcelLastExportRecord = {
  desde: string
  hasta: string
  exportedAt: string
}

type LastExportStore = {
  byRange: Record<string, string>
  lastExport: PagosGerenciaExcelLastExportRecord | null
}

function normalizeRange(desde: string, hasta: string): { desde: string; hasta: string } {
  const a = desde.trim()
  const b = hasta.trim()
  if (!a || !b) return { desde: a, hasta: b }
  return a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a }
}

/** Clave estable por rango de fechas (yyyy-MM-dd). */
export function pagosGerenciaExcelExportRangeKey(
  desde: string,
  hasta: string,
): string {
  const { desde: d, hasta: h } = normalizeRange(desde, hasta)
  if (!d || !h) return ''
  return `${d}__${h}`
}

function parseRecord(value: unknown): PagosGerenciaExcelLastExportRecord | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<PagosGerenciaExcelLastExportRecord>
  if (
    typeof row.desde !== 'string' ||
    typeof row.hasta !== 'string' ||
    typeof row.exportedAt !== 'string'
  ) {
    return null
  }
  const when = parseISO(row.exportedAt)
  if (Number.isNaN(when.getTime())) return null
  const { desde, hasta } = normalizeRange(row.desde, row.hasta)
  if (!desde || !hasta) return null
  return { desde, hasta, exportedAt: row.exportedAt }
}

function readStore(): LastExportStore {
  try {
    const raw = localStorage.getItem(PAGOS_GERENCIA_EXCEL_LAST_EXPORT_KEY)
    if (!raw) return { byRange: {}, lastExport: null }
    const parsed = JSON.parse(raw) as Partial<LastExportStore>
    if (!parsed || typeof parsed !== 'object') {
      return { byRange: {}, lastExport: null }
    }
    const byRange =
      parsed.byRange && typeof parsed.byRange === 'object'
        ? { ...parsed.byRange }
        : {}
    return {
      byRange,
      lastExport: parseRecord(parsed.lastExport),
    }
  } catch {
    return { byRange: {}, lastExport: null }
  }
}

function writeStore(store: LastExportStore): void {
  try {
    localStorage.setItem(PAGOS_GERENCIA_EXCEL_LAST_EXPORT_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

export function readLastPagosGerenciaExcelExportRecord(): PagosGerenciaExcelLastExportRecord | null {
  return readStore().lastExport
}

export function readLastPagosGerenciaExcelExportForRange(
  desde: string,
  hasta: string,
): string | null {
  const key = pagosGerenciaExcelExportRangeKey(desde, hasta)
  if (!key) return null
  const iso = readStore().byRange[key]
  if (!iso) return null
  const when = parseISO(iso)
  return Number.isNaN(when.getTime()) ? null : iso
}

export function saveLastPagosGerenciaExcelExportForRange(
  desde: string,
  hasta: string,
  iso: string,
): void {
  const { desde: d, hasta: h } = normalizeRange(desde, hasta)
  const key = pagosGerenciaExcelExportRangeKey(d, h)
  if (!key) return
  const store = readStore()
  store.byRange[key] = iso
  store.lastExport = { desde: d, hasta: h, exportedAt: iso }
  writeStore(store)
}

export function formatLastPagosGerenciaExcelExport(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es })
}

/** Rango legible para la pastilla (ej. 1-10 al 3-10 2026). */
export function formatPagosGerenciaExcelExportRangeLabel(
  desde: string,
  hasta: string,
): string {
  const { desde: d, hasta: h } = normalizeRange(desde, hasta)
  if (!d || !h) return ''
  const start = parseISO(`${d}T12:00:00`)
  const end = parseISO(`${h}T12:00:00`)
  if (d === h) {
    return format(start, 'd-M yyyy')
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, 'd-M')} al ${format(end, 'd-M yyyy')}`
  }
  return `${format(start, 'd-M yyyy')} al ${format(end, 'd-M yyyy')}`
}

export function formatLastPagosGerenciaExcelExportRangeLabel(
  record: PagosGerenciaExcelLastExportRecord,
): string {
  return formatPagosGerenciaExcelExportRangeLabel(record.desde, record.hasta)
}
