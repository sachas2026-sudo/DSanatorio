import {
  formatIntegrityAlert,
  hasIntegrityIssues,
  parseAppDataRecordWithReport,
} from './parseAppData'
import type { AppData } from '../types'

export type ValidatedBackup = {
  data: AppData
  integrityAlert: string | null
}

/** Valida JSON de respaldo sin escribir en disco. */
export function validateBackupRaw(raw: string): ValidatedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('El respaldo no es un JSON válido.')
  }
  try {
    const { data, report } = parseAppDataRecordWithReport(parsed)
    const integrityAlert = hasIntegrityIssues(report)
      ? formatIntegrityAlert(report)
      : null
    return { data, integrityAlert }
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : 'El respaldo no tiene un formato reconocido.'
    throw new Error(`Respaldo inválido: ${detail}`, { cause: err })
  }
}
