import { parseISO } from 'date-fns'
import { getEffectiveAccounts, resolveUserRealName, isGenericRoleName } from './auth'
import { getTurnoFromFecha } from './dayTurnos'

export const PAGOS_GERENCIA_EXCEL_LOG_KEY = 'pagos-gerencia-excel-log-v1'

export type PagosGerenciaExcelLogRecord = {
  id: string
  fechaExportacion: string
  usuario: string
  turno?: string
  montoEfectivo: number
  montoCuidar?: number
}

function cleanTurnoString(turno?: string): string {
  if (!turno) return ''
  return turno
    .replace(/\s*secretar[iao]\s*\d*/gi, '')
    .trim()
}

export function readPagosGerenciaExcelLog(): PagosGerenciaExcelLogRecord[] {
  try {
    const raw = localStorage.getItem(PAGOS_GERENCIA_EXCEL_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.fechaExportacion === 'string' &&
          typeof r.usuario === 'string' &&
          typeof r.montoEfectivo === 'number'
      )
      .map((r) => {
        const cleanedTurno = cleanTurnoString(r.turno)
        const cleanedUser = resolveUserRealName(r.usuario, cleanedTurno)
        return {
          ...r,
          usuario: cleanedUser,
          turno: cleanedTurno,
        }
      })
  } catch {
    return []
  }
}

export function appendPagosGerenciaExcelLog(record: PagosGerenciaExcelLogRecord): void {
  const current = readPagosGerenciaExcelLog()
  const cleanedTurno = cleanTurnoString(record.turno)
  const cleanedUser = resolveUserRealName(record.usuario, cleanedTurno)
  current.push({
    ...record,
    usuario: cleanedUser,
    turno: cleanedTurno,
  })
  try {
    localStorage.setItem(PAGOS_GERENCIA_EXCEL_LOG_KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
}

export function clearPagosGerenciaExcelLog(): void {
  localStorage.removeItem(PAGOS_GERENCIA_EXCEL_LOG_KEY)
}

export function resolveExportLogTurno(record: PagosGerenciaExcelLogRecord): string {
  const cleaned = cleanTurnoString(record.turno)
  if (cleaned && cleaned !== '—') {
    return cleaned.startsWith('Turno') ? cleaned : `Turno ${cleaned}`
  }
  if (record.usuario) {
    try {
      const accounts = getEffectiveAccounts()
      const matched = accounts.find(
        (a) =>
          a.displayName.trim().toLowerCase() === record.usuario.trim().toLowerCase() ||
          a.username.trim().toLowerCase() === record.usuario.trim().toLowerCase(),
      )
      if (matched?.turno?.trim()) {
        const t = matched.turno.trim()
        return t.startsWith('Turno') ? t : `Turno ${t}`
      }
    } catch {
      // ignore
    }
  }
  const calc = getTurnoFromFecha(record.fechaExportacion)
  return calc !== '—' ? `Turno ${calc}` : '—'
}

