import { parseAppDataJson, parseAppDataRecordWithReport, hasIntegrityIssues, formatIntegrityAlert } from './parseAppData'
import {
  loadStorageRaw,
  saveStorageRaw,
  serializeAppData,
} from './appStorage'
import { migratePaymentsPorcentajeAplicado } from './paymentPorcentaje'
import { migrateSmtpSecretFromSettings } from './smtpSecret'
import type { AppData } from '../types'

export const LOAD_READ_TIMEOUT_MS = 25_000

export const EMPTY_APP_DATA: AppData = {
  patients: [],
  doctors: [],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [],
  payments: [],
  atencionesSinTurno: [],
    pagosCancelados: [],
    pagosDeudasMedicos: [],
  especialidadesCustom: [],
  obrasSocialesCustom: [],
  localidadesCustom: [],
  motivosConsultaCustom: [],
  settings: {
    email: '',
    emailGerente: '',
    telefonoGerente: '',
    clave: '',
    telefono: '',
    cuit: '',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseAutoSync: true,
    supabaseUltimaSync: '',
  },
  planesAfiliados: [],
  afiliados: [],
  cuotasAfiliados: [],
  distribucionOSPercentajes: [],
}

export function parseStoredData(raw: string): AppData {
  return parseAppDataJson(raw)
}

export type StorageLoadResult =
  | { kind: 'ok'; data: AppData; integrityAlert?: string }
  | { kind: 'empty' }
  | { kind: 'corrupt'; message: string }

export async function loadFromStorage(): Promise<StorageLoadResult> {
  try {
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined
    const raw = await Promise.race([
      loadStorageRaw(),
      new Promise<string | null>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                'Tardó demasiado en leer la base de datos. Cerrá otros programas que la usen o reiniciá la PC.',
              ),
            ),
          LOAD_READ_TIMEOUT_MS,
        )
      }),
    ])
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    if (!raw?.trim()) return { kind: 'empty' }
    try {
      const parsed = JSON.parse(raw) as unknown
      const { data, report } = parseAppDataRecordWithReport(parsed)
      const integrityAlert = hasIntegrityIssues(report)
        ? formatIntegrityAlert(report)
        : undefined
      return { kind: 'ok', data, integrityAlert }
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : 'Error al interpretar el archivo.'
      return {
        kind: 'corrupt',
        message: detail,
      }
    }
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : 'No se pudo leer el archivo de datos.'
    return { kind: 'corrupt', message: detail }
  }
}

export async function enrichLoadedData(data: AppData): Promise<AppData> {
  const clave = await migrateSmtpSecretFromSettings(data.settings)
  const migrated = migratePaymentsPorcentajeAplicado(data)
  return {
    ...data,
    payments: migrated.payments,
    pagosCancelados: migrated.pagosCancelados,
    pagosDeudasMedicos: data.pagosDeudasMedicos ?? [],
    atencionesSinTurno: data.atencionesSinTurno ?? [],
    planesAfiliados: data.planesAfiliados ?? [],
    afiliados: data.afiliados ?? [],
    cuotasAfiliados: data.cuotasAfiliados ?? [],
    distribucionOSPercentajes: data.distribucionOSPercentajes ?? [],
    settings: { ...data.settings, clave },
  }
}

export async function saveAppData(data: AppData): Promise<void> {
  await saveStorageRaw(serializeAppData(data))
}
